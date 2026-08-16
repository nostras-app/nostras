---
name: health-check
description: Use when the user wants to know if NOSTRAS is actually working right now — "check the DVM's still up", "is the relay healthy", "check the client build", "check the wallet connection", "check the dashboard", a general "check system health" / "is everything OK" — **or after making any code change to client/ or server/, as a standing regression check before considering the change done.** Section 0 (regression checks) runs against the local working tree, no deploy or production access needed; sections 1-5 are live functional checks against production. Never just trusts `flyctl status` alone, since this project has repeatedly found machines that show "started" while genuinely broken — and never just trusts that a fix "should work," since this project has repeatedly found the exact same recurring bug classes reintroduced in new files.
---

# NOSTRAS system health check

`flyctl status` showing `started` is not proof of health — this project
has hit at least three distinct failure modes that still look green
there (a boot-vs-DNS race, a silent clean-exit-on-disconnect, a dropped
NWC relay connection). Every live check below does a real functional
round-trip instead of trusting a status table. Report results as a short
pass/fail summary with the key evidence number for each (latency,
memory, a matched job id, etc.) — not a wall of raw command output.

**After any code change to `client/` or `server/`, run Section 0
before considering the change done** — it's static (greps the working
tree, no deploy needed) and catches the specific bug classes this
project has independently rediscovered three or more times each (see
`NOSTRAS-CSV.md`'s "Recurring pattern" notes). If the user only asked
about one live component ("check the DVM"), run just that section. If
they ask generally ("check system health", "is everything OK"), run
Sections 1-5 in order and give one consolidated report — Section 0 is
about *code*, not live status, so it's not part of a "is prod OK"
sweep unless something in it looks newly relevant.

Use a scratch dir for temp files: `${CLAUDE_JOB_DIR:-/tmp}/tmp` if set,
otherwise a fresh `mktemp -d`. Never write scratch files to a shared
`/tmp` path a parallel job might clobber.

## 0. Regression checks — known recurring bug classes (run after every code change)

Every check here targets a bug class this project has hit **more than
once**, independently, in different files — confirmed by
`NOSTRAS-CSV.md`'s own "Recurring pattern requiring standing vigilance"
notes and PQ log. The point isn't "did this specific bug come back,"
it's "does the *shape* of this bug exist anywhere else in the tree
right now" — that's what actually caught the `moderationLabel.ts`
instance during this skill's own first build (found via 0a below,
before any user ever reported it broken).

### 0a. Missing-timeout audit (client)

The single most-recurring class in this project — Bookmarks, Blossom
uploads, zap invoice fetches, search, six subscription hooks, and
`moderationLabel.ts` have each independently hit this. Two different
severities, since NDK's own behavior differs by call shape:

```
cd client/src
echo "--- fetchEvents() (plural) — NO internal NDK timeout, most urgent ---"
for f in $(grep -rl "\.fetchEvents(" --include="*.ts" --include="*.tsx" .); do
  grep -q "withTimeout" "$f" || echo "NO TIMEOUT GUARD: $f"
done
echo "--- fetchEvent() (singular) — NDK has an internal ~10s fallback, lower severity but still a silent multi-second hang with no user feedback ---"
for f in $(grep -rl "\.fetchEvent(" --include="*.ts" --include="*.tsx" .); do
  grep -q "withTimeout" "$f" || echo "no explicit timeout (bounded ~10s by NDK): $f"
done
```
Any `fetchEvents()` hit with no `withTimeout` in the same file is a
near-certain repeat — fix it the same way `BookmarksView.tsx` and
`moderationLabel.ts` were fixed (wrap in `withTimeout()`, imported from
`lib/podcast.ts` per this project's own established shared-import
precedent, not a fresh per-file copy unless there's a real reason to
diverge). A `fetchEvent()` (singular) hit is lower priority — flag it,
don't necessarily block on it.

Also check `ndk.subscribe(` calls for the sibling bug (PQ-033: missing
EOSE fallback on long-lived subscriptions — a subscription whose
`loading` state only ever clears on `eose`, with no fallback timer, has
the identical "stuck forever if one relay never responds" shape):
```
grep -rln "ndk.subscribe(" --include="*.ts" --include="*.tsx" . | xargs grep -L "EOSE_FALLBACK\|eoseFallback"
```
A hit here isn't automatically broken (some subscriptions intentionally
have no timeout), but is worth a quick read to confirm `loading` has
some other way to resolve.

### 0b. Unscoped authors-filtered query audit (client)

`useFollowing`/`useFollowCounts`/`useNoteFeed`/`useProfile`/`BookmarksView`
all independently hit the same race: an `authors`-filtered
`fetchEvent`/`subscribe` call with no explicit relay set can resolve
against whatever NDK happens to have `CONNECTED` at that exact moment,
producing a stale or empty answer. This one needs a human read, not just
a grep pass (the relay-set argument is often on a different line) — but
grep narrows the search fast:
```
grep -rn "authors:\s*\[" --include="*.ts" --include="*.tsx" client/src
```
For each hit, confirm the same call passes an explicit `relaySet`
(`authorQueryRelaySet` for cross-relay author data, `localRelaySet` for
anything NOSTRAS-own-relay-scoped like groups/paid content). A hit with
no relay set argument anywhere nearby is a real, not hypothetical,
candidate for this exact bug.

### 0c. Insecure/mixed-content image rendering (client)

The "Not Secure" incident (fixed across ten call sites) established
that every rendered image URL from untrusted content must go through
`isSecureImageUrl()`. A same-line grep produces mostly noise (the guard
is usually a ternary/`&&` wrapper a line or two above the `<img>`, not
on the same line) — this version checks a 3-line window above each hit
too, tested and confirmed lower-noise than a naive grep:
```
for f in $(grep -rl "<img" --include="*.tsx" client/src); do
  awk -v file="$f" '
    /<img/ {
      guarded = 0
      for (i = 1; i <= 3; i++) if ((NR-i) in ctx && ctx[NR-i] ~ /isSecureImageUrl/) guarded = 1
      if ($0 ~ /isSecureImageUrl/) guarded = 1
      if (!guarded) print file":"NR": "$0
    }
    { ctx[NR] = $0 }
  ' "$f"
done
```
Even this will still surface two known-safe false-positive shapes —
read each hit, don't just count them:
- A **hardcoded string** `src="/favicon.svg"`-style literal (a static
  asset, never user data) — always safe.
- `NoteContent.tsx`'s `emoji`/`image` segment renders (`<img
  src={seg.url}>`) — these are guarded **upstream**, in
  `lib/parseContent.ts`'s own segment parser (`isSecureImageUrl()` is
  called there, before a segment is ever constructed), not locally at
  the render site — confirmed by reading `parseContent.ts` directly,
  not assumed. A hit here is expected and not a real finding.

Any *other* hit — a URL-valued `src` with no guard anywhere in its own
data's construction path — is a real, not hypothetical, candidate.

### 0d. Horizontal overflow (client, CSS/layout changes only)

Found and independently re-found three times (reply-context snippets,
article markdown bodies, a third full-surface sweep) before being
treated as a standing category. Not grep-able — after any CSS/layout
change, do a live narrow-viewport check: load the affected page/view at
a real narrow width and confirm
`document.documentElement.scrollWidth <= window.innerWidth` directly in
the browser, the same technique already established in this project's
own history. Skip this step for changes with no layout/CSS impact.

### 0e. Server: process-group-without-http_service liveness (server changes only)

Not a grep — a standing reminder inline here since it's server-specific
and easy to forget mid-change: any change that touches `server/` and
gets deployed should be followed by checking the `dvm` process group's
status specifically (Section 1 below), not just `web`'s HTTP endpoint —
this exact gap silently missed a real ~2-hour DVM outage once already
precisely because only `web` was checked.

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

Since 2026-08-16 this is a deliberate public/private split, not one
uniformly gated surface — confirming *both* halves landed correctly
matters here, not just "does auth still work":

```
echo "--- must be 401 (operator-only: live health, DVM health, waitlist emails) ---"
curl -s -o /dev/null -w "HTTP: %{http_code}\n" https://nostras.app/dashboard
curl -s -o /dev/null -w "HTTP: %{http_code}\n" https://nostras.app/dashboard/health
curl -s -o /dev/null -w "HTTP: %{http_code}\n" https://nostras.app/dashboard/waitlist
echo "--- must be 200, no credentials (aggregate, no-PII usage data) ---"
curl -s -o /dev/null -w "HTTP: %{http_code}\n" https://nostras.app/dashboard/data
curl -s -o /dev/null -w "HTTP: %{http_code}\n" https://nostras.app/stats
```
Pass = the first three `401` with no credentials (confirms the
operator/PII surfaces are still closed, not silently broken open — this
is the more dangerous direction to regress in), the last two `200`
(confirms the public stats page and its data endpoint still work). A
`401` on `/dashboard/data` or `/stats` is *also* a real regression, not
a false-positive "more secure than expected" — it means the public
usage-stats feature itself broke.

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
