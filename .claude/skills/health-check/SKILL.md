---
name: health-check
description: Use when the user wants to know if NOSTRAS is actually working right now — "check the DVM's still up", "is the relay healthy", "check the client build", "check the wallet connection", "check the dashboard", or a general "check system health" / "is everything OK". Runs a fixed sequence of real functional checks against production (relay, DVM process, DVM's NWC wallet, client build, analytics dashboard) and reports pass/fail with evidence — never just trusts `flyctl status` alone, since this project has repeatedly found machines that show "started" while genuinely broken.
---

# NOSTRAS system health check

`flyctl status` showing `started` is not proof of health — this project
has hit at least three distinct failure modes that still look green
there (a boot-vs-DNS race, a silent clean-exit-on-disconnect, a dropped
NWC relay connection). Every check below does a real functional
round-trip instead of trusting a status table. Run them in order; each
is cheap and fast. Report results as a short pass/fail summary with the
key evidence number for each (latency, memory, a matched job id, etc.)
— not a wall of raw command output.

If the user only asked about one component ("check the DVM"), run just
that section. If they ask generally ("check system health", "is
everything OK"), run all five in order and give one consolidated report.

Use a scratch dir for temp files: `${CLAUDE_JOB_DIR:-/tmp}/tmp` if set,
otherwise a fresh `mktemp -d`. Never write scratch files to a shared
`/tmp` path a parallel job might clobber.

## 1. DVM process & job pipeline

```
flyctl status --app nostras
```
Confirm the `web` and (non-standby) `dvm` machine both show `started`.
Note the `web` machine's ID — needed for the SSH checks below.

Then prove it's actually processing, not just running:
```
SK=$(nak key generate)
PK=$(nak key public $SK)
nak event -k 5050 -c "What is 2+2?" -t "i=What is 2+2?;text" --sec "$SK" wss://nostras.app
timeout 30 nak req -k 7000 -k 6050 --tag "p=$PK" wss://nostras.app
```
Pass = a real `kind:7000` (`payment-required` or `processing`) or
`kind:6050` event comes back referencing that pubkey, within the
timeout. **If a `payment-required` event comes back with a real bolt11
invoice, do not pay it** — this only proves the pipeline works, never
send a real payment as part of a health check (standing project rule,
see `payInvoiceWithNwc` in CLAUDE.md).

## 2. DVM's NWC wallet connection

SSH into the `web` machine (ID from step 1) and hit the DVM's private
health endpoint directly — this is the one thing a public job round-trip
can't distinguish (payment-required happens the same way whether or not
the invoice-minting wallet is actually reachable, since a mint failure
also surfaces as an error event, but checking the DVM's own self-report
is faster and more direct):
```
flyctl ssh console --app nostras --machine <web-machine-id> -C "wget -qO- http://dvm.process.nostras.internal:7778/health"
```
(No `curl` in the container — use `wget -qO-`.) Pass = valid JSON with
`"paymentGating":true` and `"relayConnected":true`. Cross-check
`lastJobUnix` against the job published in step 1 if both ran in the
same pass — a match confirms the DVM that answered is the same one
reporting this health data. If `NOSTRAS_DVM_NWC_URI` is intentionally
unset (free mode), `paymentGating` will correctly read `false` — that's
not a failure, just note it in the report.

If the endpoint/port ever changes, the current values live in
`server/fly.toml` under `NOSTRAS_DVM_HEALTH_URL` /
`NOSTRAS_DVM_HEALTH_PORT`.

## 3. Relay health

```
curl -s -w "\nHTTP: %{http_code} | time: %{time_total}s\n" -H "Accept: application/nostr+json" https://nostras.app/
```
Pass = HTTP 200, valid NIP-11 JSON, sub-second response.

Then a real functional round-trip (a bare NIP-11 fetch doesn't prove
publish/query works):
```
SK=$(nak key generate)
PK=$(nak key public $SK)
MARKER="nostras-healthcheck-$(date +%s)"
nak event -k 1 -c "$MARKER" --sec "$SK" wss://nostras.app
timeout 10 nak req -k 1 -a "$PK" -l 5 wss://nostras.app | grep -o "$MARKER"
```
Pass = the marker comes back. Note the publish latency — this project
has seen publish latency spike to multi-second/failing under real load
(outbox-aggregation starvation, connection exhaustion, badger memory
pressure all did this at different points), so a slow publish here
(>2s) is worth flagging even if it technically succeeds.

Then a resource check via the same SSH session as step 2:
```
flyctl ssh console --app nostras --machine <web-machine-id> -C "sh -c 'cat /proc/loadavg; grep -E \"MemTotal|MemAvailable\" /proc/meminfo'"
```
Pass = load average well under core count, `MemAvailable` with real
headroom (not single-digit MB — this project hit genuine near-OOM
incidents at that point). Flag, don't necessarily fail, on elevated but
not critical numbers.

## 4. Client build

```
curl -s -o /dev/null -w "HTTP: %{http_code} | time: %{time_total}s\n" https://app.nostras.app/
flyctl status --app nostras-client
```
Pass = HTTP 200, both `app` machines `started`.

Then confirm the live bundle isn't stale — this matters because a
failed/false-negative CI run can leave production serving an old build
while `flyctl status` still looks fine:
```
BUNDLE=$(curl -s https://app.nostras.app/ | grep -oE 'assets/index-[a-zA-Z0-9_-]+\.js' | head -1)
curl -s "https://app.nostras.app/$BUNDLE" -o "$SCRATCH/bundle.js"
git log --oneline -1 -- client/
grep -c "$(git rev-parse --short <that commit>)" "$SCRATCH/bundle.js"
```
Pass = the short SHA of the latest `client/`-touching commit appears in
the live bundle. A mismatch means the deploy didn't actually go out
(check `gh run list --workflow=deploy-client.yml` next).

## 5. Analytics dashboard

The dashboard is Basic-Auth gated (`NOSTRAS_DASHBOARD_PASSWORD`, a Fly
secret the user sets themselves — **never** stored in `nostras.env` or
known to Claude). Two checks that don't need the password:

```
curl -s -o /dev/null -w "HTTP: %{http_code}\n" https://nostras.app/dashboard
curl -s -o /dev/null -w "HTTP: %{http_code}\n" https://nostras.app/dashboard/data
```
Pass = both `401` with no credentials — confirms the gate is closed,
not silently broken open.

Then confirm the underlying pipeline is actually recording (this file
holds only aggregated day/country counts, never raw IPs — safe to read
directly, no privacy concern per the feature's own design):
```
flyctl ssh console --app nostras --machine <web-machine-id> -C "cat /data/analytics.json"
```
Pass = valid JSON, `total` > 0, a `by_day` entry for today. A missing or
empty file most likely means `NOSTRAS_ANALYTICS_PATH` fell back off the
persistent `/data` volume again — see the "silently living on ephemeral
storage" incident in CLAUDE.md for the exact failure mode.

## Reporting back

One short paragraph or a tight bullet list per section — component name,
pass/fail, one or two concrete numbers as evidence (latency, memory,
job/marker match, bundle SHA). Call out anything that passed but looked
marginal (elevated latency, a large `unknown` analytics bucket, a
free-mode NWC when the user expected payment gating on) rather than
silently rounding it up to a clean pass. If something fails, say exactly
which check failed and what the raw output was — don't speculate about
root cause unless asked to dig further.
