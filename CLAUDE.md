# CLAUDE.md

Guidance for Claude Code in this repository. Kept short on purpose: the
dated engineering log (every feature, bug, incident and verification since
2026-08-04) lives in [`docs/history/`](docs/history/), one file per month.
When a code comment or another doc says "see CLAUDE.md's dated entry",
search `docs/history/` for it.

## Project

**NOSTRAS** is a Nostr client (installable PWA, `app.nostras.app`) paired
with its own relay (`wss://nostras.app`) and a paid AI service (a NIP-90
DVM). The client is the protocol-native, trust-neutral piece; the relay is
where extra services (search, outbox aggregation, push, DVMs) are delivered,
as standard NIPs wherever possible. Open source, AGPL-3.0, at
`github.com/nostras-app/nostras` (public; issues there too).

Bring your own signer and wallet: NOSTRAS never holds anyone's keys or
funds. Strategy, roadmap and growth/engagement logs:
`nostr-client-node-strategy.md` (local, gitignored); read it for the "why"
before architectural changes.

## Repo map

| Path | What |
|---|---|
| `client/` | The PWA: React + Vite + TypeScript, `vite-plugin-pwa` (injectManifest, `src/sw.ts`), `@nostr-dev-kit/ndk`. Styles in `src/index.css` (tokens) and `src/App.css` (components); no CSS-in-JS/Tailwind |
| `client/src/lib/ndk.ts` | NDK instance and the relay sets (see "Relay scoping") |
| `server/` | The relay: [khatru](https://github.com/fiatjaf/khatru) (local fork in `internal/khatrufork/`), badger event store (local fork in `internal/eventstorefork/`), bluge search index. One Go module |
| `server/cmd/dvm/` | The DVM, a second binary in the same module |
| `server/*.html` | Landing pages served by the relay: `/`, `/why`, `/node`, `/stats`, `/tools`, `/dashboard` (password) |
| `agent/` | The NOSTRAS Agent (desktop systemd daemon + evangelist). See `NOSTRAS-AGENT.md` |
| `docs/` | `local-ai.md` (running the DVM on your own models), `history/` (the dated log) |
| `NOSTRAS-CSV.md` | IQ/OQ/PQ-style validation log (local, gitignored) |
| `nostras-nips-compliance.md`, `nostras-exclusive-features.md`, `nostras-dao-how-to.md` | Feature references (local) |
| `.claude/skills/` | `health-check`, `engage`, `build-in-public`, `distribute`, `grow`, `podcast` |

## Running locally

```sh
cd server && go run .                 # relay on :7777, data in server/data
cd server && go run ./cmd/dvm         # DVM; reads ../.nostras.env (needs NOSTRAS_ANTHROPIC_API_KEY)
cd client && npm run dev              # client on :5173, relay = VITE_RELAY_URL or ws://localhost:7777
```

Checks before calling a change done:
- client: `npx tsc -b`, `npx oxlint`, `npx vite build`
- server: `go build ./...`, `go vet ./...`, `gofmt -l .`, `go test ./...`
- then the `health-check` skill's **Section 0** regression checks.

Testing rules:
- Use throwaway keys only (`nak key generate`); never the user's real keys
  in `.nostras.env`. When a throwaway publishes to production, save its
  secret (scratchpad), not just the pubkey.
- Verify in a real browser before committing. One feature at a time:
  build, verify, commit.
- `nak` reads stdin when it isn't a terminal: add `</dev/null` in scripts
  and loops, or it hangs silently.
- A relay you run for a test should use a scratch data dir and port; kill
  `go run` children by PID (`lsof -i :PORT`), not by name pattern.

## Production

| Fly app | Process | Size | Notes |
|---|---|---|---|
| `nostras` | `web` (relay, landing pages) | performance-1x, 4 GB | volume `nostras_data` 20 GB at `/data` (badger, bluge, all JSON stores) |
| `nostras` | `dvm` | shared-cpu-1x, 512 MB | reaches the relay at `ws://web.process.nostras.internal:7777`; health on `:7778` |
| `nostras-client` | static client (nginx) | – | `VITE_RELAY_URL` baked in at build |

- **Deploys:** GitHub Actions, path-filtered: `deploy-relay.yml`
  (`server/**`), `deploy-client.yml` (`client/**`). `uptime-check.yml` runs
  every 30 min and sends a real DVM job.
- **Version check:** relay NIP-11 `version` and Settings > About show the
  deployed commit SHA.
- **Secrets (names):** `NOSTRAS_ANTHROPIC_API_KEY`, `NOSTRAS_DVM_NWC_URI`,
  `NOSTRAS_DVM_IDENTITY_KEY`, `NOSTRAS_DVM_ARTICLE_KEY`,
  `NOSTRAS_DVM_COMMUNITY_KEY`, `NOSTRAS_VAPID_PRIVATE_KEY`/`PUBLIC_KEY`/
  `SUBSCRIBER`, `NOSTRAS_DASHBOARD_PASSWORD`. After `flyctl secrets set`,
  confirm with `flyctl secrets list`.
- **After any deploy or secrets change:** `flyctl status --app nostras` and
  check the `dvm` machine (not the standby) is `started`. A process group
  without an `[http_service]` can stay stopped after an update, and Fly
  doesn't restart a machine that exited 0 or hit its restart limit. Prove
  liveness with a real DVM job (`payment-required` is enough; never pay).
- **New persistent files** go under `/data` via a `fly.toml` env var in the
  same commit. Three stores once lived on ephemeral disk and were wiped on
  every deploy.
- **Disk:** `/data` has filled up three times (most recently 2026-10-02).
  Outbox cache retention is 7 days; the storage scan is on the dashboard.

## Standing rules

- **Custody:** bring-your-own signer (NIP-07, NIP-46) and wallet (NIP-47),
  permanently. Never build hosted keys or funds.
- **Payments:** Claude requests and displays invoices; the user pays.
  `payInvoiceWithNwc` only ever runs from an explicit user click. Never pay
  a test invoice.
- **Publish scope (`devPublishRelaySet`):** dev builds publish to the local
  relay only (so testing never reaches the public network); production
  builds publish to our relay + `publicRelayUrls`. Don't change the dev
  default without deciding to.
- **Group (NIP-29) and paid-content data** stays on our relay
  (`localRelaySet`), never `devPublishRelaySet`.
- **Untrusted input:** note content, profiles, relay lists, relay hints and
  NIP-05 data come from strangers. Filter relay URLs with
  `makeRelayConnectionFilter` before `NDKRelaySet.fromRelayUrls` (it
  bypasses the pool filter); render only `https:` media
  (`isSecureImageUrl`).
- **Commits:** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Never commit secrets; check `git status` before broad adds.
- **Public content** (notes, replies, DMs) is never sent without the user's
  sign-off, except the NOSTRAS Agent within its own code-enforced limits.

## Gotchas (recurring bug classes)

Each of these has bitten more than once; details in `docs/history/`.

- **Timeouts everywhere.** `ndk.connect(ms)` always; `fetchEvents()` has no
  internal timeout (wrap it with `withTimeout`); every `publish()` gets an
  explicit timeout (8 s convention) and a surfaced error; long-lived
  subscriptions need an EOSE fallback timer (12 s).
- **Relay scoping for author queries.** An authors-filtered NDK query with no
  relay set races NDK's connected-relays fallback: pass
  `authorQueryRelaySet` (or `localRelaySet`). An id-only `fetchEvents` with no
  set waits for every explicit relay, including a dead custom one.
- **Replaceable events** (kind 0, 3, 10002, 1000x, 3xxxx): use
  `fetchLatestReplaceableEvent` (waits the full window, keeps the newest);
  `fetchEvent` can settle on a stale copy. Edit hooks must not publish before
  the current list has loaded (data loss), and must merge, not replace
  (kind:0 keeps fields the form doesn't edit).
- **Cross-component state** shared by several mounted views uses a
  module-level `useSyncExternalStore` store, not per-component `useState`
  (every view stays mounted).
- **NDK quirks:** `NDKRelayAuthPolicies.signIn` hangs (use `async () => true`);
  NIP-46 `connect` acks that echo the secret are rejected (we fall back to
  `get_public_key`); NDK's own reconnect scheduling never fires
  (`relayStatus.ts` retries); `generateZapRequest` builds a malformed `e`
  tag (we build the zap request ourselves); `NDKKind` lacks many kinds
  (cast).
- **Relay hot path:** khatru `StoreEvent`/`OnEventSaved`/`RejectEvent` hooks
  run for every event; no synchronous locks or network calls there
  (dispatch to a goroutine). `relay.QueryEvents` goes through outbox
  aggregation; internal lookups must skip it (`khatru.IsInternalCall`).
- **Kind collisions:** kind 11 is both NIP-29 group threads and NIP-7D
  threads (ungrouped = no `h` tag). Check go-nostr/NDK kind catalogs before
  claiming a kind.
- **Service worker:** a tab open across several deploys reloads once per
  version (15 s guard); "Check for updates" unregisters, clears caches and
  reloads. Test SW changes with `vite preview`, not `npm run dev`.
- **Layout:** any new text surface needs `overflow-wrap: anywhere` and
  `min-width: 0` up the flex chain; check `scrollWidth` at ~400 px.
- **NIP-59 gift wraps** randomize their outer `created_at` (up to 2 days
  back): never filter or reason about DMs by the wrap's timestamp.
- **Fly:** shared IPv4 delays custom-domain certs (use a dedicated IP);
  `flyctl` only merges `--build-arg`s declared in `fly.toml`; `flyctl logs`
  streams forever (wrap in `timeout`).

## Shipped features

The client covers feeds (following, global, NIP-51 lists), notes, articles
(NIP-23), forum threads (NIP-7D), polls (NIP-88), zap goals (NIP-75),
podcasts (NIP-F4), comments (NIP-22), DMs (NIP-17), communities (NIP-29,
including pay-to-post and DAOs), marketplace listings (NIP-99), badges,
statuses, linked accounts, search (NIP-50), push notifications, multiple
local identities (NIP-49 encryption), NWC zaps, paid articles/episodes, and
a job board.
Full NIP-by-NIP status: `nostras-nips-compliance.md`. What only NOSTRAS
renders: `nostras-exclusive-features.md`.

**DVM job kinds** (`server/cmd/dvm/`): 5001 summarize, 5002 translate,
5050 ask, 5501 spam/scam check (with a NIP-32 label), 5904 paid-content
unlock, 5906 community join, 5907 listing purchase, 5908 job board
completion payment, 5909 DAO proposal registration/tally (results = request + 1000).
AI jobs accept NIP-90 encrypted requests, price per token, and can run on
any OpenAI-compatible backend (`docs/local-ai.md`).

**Relay extras:** NIP-65 outbox aggregation (author queries fan out to the
authors' write relays; results cached 7 days) and Web Push via
NIP-98-authenticated subscriptions. Advertised in production NIP-11: 1, 9,
11, 29, 40, 42, 45, 50, 62, 70, 86. Implemented but **off in production**:
NIP-43 and NIP-66 (need `NOSTRAS_RELAY_PRIVATE_KEY`) and NIP-13 PoW (needs
`NOSTRAS_MIN_POW_DIFFICULTY`).

## Conventions

- NIP numbers are the shared vocabulary: use them in code and commits
  ("NIP-57 zap request"), not invented names.
- Write in plain language; match the surrounding code's comment density.

## History

- [`docs/history/2026-08.md`](docs/history/2026-08.md): launch to late August (MVP through every NIP gap, the Fly deploy, the big incidents).
- [`docs/history/2026-09.md`](docs/history/2026-09.md): Lists, badges, Community DAOs.
- [`docs/history/2026-10.md`](docs/history/2026-10.md): open-sourcing, encrypted and local-model AI jobs, storage incidents, the NOSTRAS Agent.

**New dated entries go to the current month's file** in `docs/history/`
(create it at the start of a month, same header format). Update this file
only when a rule, a gotcha or the current state changes.
