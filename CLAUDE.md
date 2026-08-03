# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

App name: **NOSTRAS**.


A Nostr PWA client paired with a self-hosted Nostr relay/node, distributed
without app stores. The client is the trust-neutral, protocol-native piece;
the relay/node is where differentiated services (search, aggregation,
notifications, DVMs) get delivered, implemented as standard NIPs wherever
possible rather than proprietary APIs.

Full rationale, the NIP-by-NIP service brainstorm, the phased build roadmap,
and all decisions made so far live in `@nostr-client-node-strategy.md` —
read it for the "why" before making architectural changes.

## Status

Phase 0 (MVP) is underway. The client can read a live kind:1 feed (from
local + public relays), publish new kind:1 notes, and set/edit kind:0
profile metadata (name/about) — all publishing scoped to the local relay
only, see below. Profile lookups are cached in `client/src/hooks/useProfile.ts`
via `useSyncExternalStore` (module-level cache, shared across components,
reactive to `setCachedProfile` so a freshly-saved profile shows immediately
without a relay round-trip).

Phase 1's real bring-your-own-signer support has also landed: NIP-46
(remote signer / bunker) is implemented in `client/src/lib/remoteSigner.ts`
and `client/src/components/SignerConnect.tsx` — paste a `bunker://` URI to
connect, disconnect to fall back to the dev key, session persists across
reloads (the local connection key is saved so reconnecting doesn't require
re-approval). `client/src/hooks/useActiveUser.ts` makes `ndk.activeUser`
reactive via the `activeUser:change` event — components must use this
hook rather than reading `ndk.activeUser` once at render time, since it
changes whenever the signer is swapped (this was a real bug: `ProfileEditor`
kept editing the old user's profile after a signer switch until it was
fixed to use this hook).

NIP-07 (browser extension, e.g. Alby/nos2x) support has also landed, in
the same `remoteSigner.ts`/`SignerConnect.tsx` — the "Connect browser
extension" button only enables when `window.nostr` is actually present.
Both NIP-46 and NIP-07 share one signer-mode flag in localStorage
(`nostras:signer-mode`) so reload correctly restores whichever one was
last connected. Verified end-to-end against a real Alby install: connect,
sign, publish (real pubkey, valid signature, local-relay-only), reload
persistence, and disconnect all confirmed working.

There is still a temporary dev-only local key (`client/src/lib/signer.ts`)
used as the default/fallback signer — this was always meant to be
replaced/supplemented by real signer support, not removed outright, since
it's still useful for quick local testing.

Phase 1's zap support (NIP-57 + NIP-47/NWC) has also landed:
`client/src/lib/zap.ts` builds a zap request and fetches a real bolt11
invoice from the recipient's LNURL-pay endpoint (`lud16`/`lud06`) — this
only does HTTP GETs, no funds move. `client/src/lib/nwc.ts` implements the
NIP-47 wallet-connect protocol by hand (kind 23194 request / 23195
response, NIP-04 encrypted) since core `@nostr-dev-kit/ndk` doesn't ship a
wallet client, only zap orchestration (`NDKZapper`, `generateZapRequest`,
`zapInvoiceFromEvent`, `getNip57ZapSpecFromLud`). `ZapButton.tsx` always
offers "Copy invoice" for manual payment, and additionally "Pay with
connected wallet" once a `nostr+walletconnect://` URI is saved via
`NwcConnect.tsx`. **`payInvoiceWithNwc` executes a real payment against
whatever wallet the connection string points to — it must only ever run
from an explicit user click, never automatically or as part of any
scripted/agent flow.** It was verified against a disposable mock wallet
(fake keys, fake response, no real Lightning involved) to prove the
request/response protocol wiring is correct; it has not been exercised
against a real wallet, since that would mean an AI agent authorizing a
real financial transaction.

The client also got a real design pass (previously plain unstyled HTML).
`client/src/index.css` holds the design tokens (CSS custom properties:
`--bg`, `--bg-card`, `--text`, `--accent`, `--success`, `--danger`,
`--zap`, etc. — both a light and a `prefers-color-scheme: dark` set,
already existed from the Vite template and were extended rather than
replaced). `client/src/App.css` holds actual component styles (`.card`,
`.btn`/`.btn-primary`/`.btn-secondary`, `.input`/`.textarea`, `.feed-item`,
`.zap-pill`, etc.) — components use these classes, no CSS-in-JS or
Tailwind. `App.tsx` now has a header (wordmark + connection status pill +
gear icon) and tucks `SignerConnect`/`NwcConnect`/`ProfileEditor` into a
collapsible settings panel instead of always showing them, so the primary
view is just the composer and feed. Verified visually in-browser: desktop,
a 390×750 mobile viewport (no overflow, cards reflow correctly), the
settings panel open/closed, and the zap amount/invoice panel expansion.

Check `client/package.json` / `server/go.mod` before assuming a command
exists.

## Architecture

- `client/` — the PWA, package name `nostras`. React + Vite + TypeScript,
  `vite-plugin-pwa` (Workbox-based service worker/installability, manifest
  under the NOSTRAS name), `@nostr-dev-kit/ndk` for relay pool management,
  event caching, and signer abstraction. Bootstrap relay list lives in
  `client/src/lib/ndk.ts` (`ws://localhost:7777` for the local khatru node +
  a couple of public relays, read-only, so the dev feed isn't empty).
  **Publishing is scoped to `devPublishRelaySet` (local relay only)** — do
  not change this to publish to the public relays without deliberately
  deciding to, since anything typed into the dev composer would otherwise
  broadcast to the real public Nostr network. Run with `npm run dev` from
  `client/`.
- **`ndk.connect()` gotcha**: always call it with a timeout (e.g.
  `ndk.connect(5000)`). `NDKPool.connect()` waits for *every* relay in the
  set to reach `CONNECTED` and, with no timeout argument, its fallback
  promise never resolves — so one slow/unreachable relay hangs the whole
  app's connection state forever. This bit us once already; see
  `client/src/App.tsx`.
- `server/` — the relay/node. [khatru](https://github.com/fiatjaf/khatru)
  (Go relay framework), chosen over binary relays like `strfry` because
  later roadmap phases need to intercept/rewrite `REQ` filters in code
  rather than configure a black-box binary. Storage is the `badger`
  eventstore backend (pure Go, no cgo) writing to `server/data/`
  (gitignored). Listens on `:7777`. Run with `go run .` from `server/`.
- **NIP-65 outbox aggregation is implemented** (`server/outbox.go`,
  wired into `relay.QueryEvents` in `main.go`), using
  `github.com/nbd-wtf/go-nostr/sdk`'s `System` — it already has this exact
  model built in (`FetchOutboxRelays`, `FetchFeedPage`), no need to
  hand-roll it. For any `REQ` filter with `Authors` set, the query function
  serves local results first, then calls `sys.FetchFeedPage` to fan out to
  each author's declared write relays (per their kind:10002) and fetch
  anything missing, deduplicating by event ID before sending to the
  client. Fetched events get written into the same badger store as a side
  effect, so repeat queries get progressively cheaper. Filters with no
  `Authors` skip aggregation entirely (local-only). Bootstrap relays for
  discovering kind:10002 lists: `relay.damus.io`, `relay.primal.net`,
  `purplepag.es`.
  **Sandbox testing note**: this dev/CLI sandbox allows outbound HTTPS but
  blocks outbound WebSocket connections (confirmed via both a raw Go dial
  and Node — both get a `503` on the WS handshake), so the remote-fetch
  path couldn't be exercised from inside this environment — only build/vet
  and the local-store regression path were verified here. **Confirmed
  working end-to-end by the user on their own machine** (2026-08-03) using
  `nak req -k 1 -a <pubkey> ws://localhost:7777` against a pubkey that had
  never touched the local relay — real notes came back, fetched live via
  that author's actual NIP-65 write relays.
- **NIP-50 search is implemented** (`server/search.go`), using
  `github.com/fiatjaf/eventstore/bluge` — a pure-Go (no cgo) full-text
  index that stores only event IDs and fetches the actual events from the
  badger store. Any `REQ` filter with a non-empty `search` field is routed
  entirely to bluge instead of the normal query/aggregation path; filters
  without `search` are unaffected. Indexed on `relay.StoreEvent` alongside
  badger, so anything published directly to this relay is searchable.
  **Known scope gap**: events pulled in via NIP-65 outbox aggregation
  aren't indexed yet, since that path writes to the store directly rather
  than through khatru's hooks — search currently only covers directly
  published content. `relay.Info.AddSupportedNIP(50)` had to be added
  explicitly — khatru only auto-advertises NIPs 9/45/77 based on which
  hooks are registered, it has no concept of "search," so this one won't
  show up in NIP-11 without setting it by hand. Verified locally (fully
  testable in-sandbox, no outbound relay connections needed): published
  three notes with distinct content, confirmed each search term matched
  only its note and an unmatched term returned nothing.
- **Phase 3 has started: a NIP-90 DVM (Data Vending Machine) is implemented**
  at `server/cmd/dvm/main.go` — a second binary in the same Go module as the
  relay (`go run ./cmd/dvm` from `server/`), not a separate module, since it
  shares the relay's dependencies. Offers text summarization (job kind
  `5001` -> result kind `6001`, per the NIP-90 kind registry — see
  `github.com/nbd-wtf/go-nostr/nip90` for the full catalog). Listens on the
  local relay only. Uses the real Claude API
  (`github.com/anthropics/anthropic-sdk-go`, model `claude-opus-5`) for the
  actual summarization — this is not a placeholder/mock, per an explicit
  user decision to wire up a real LLM rather than a naive heuristic.
  **Requires `NOSTRAS_ANTHROPIC_API_KEY` in `nostras.env`** at the project
  root (loaded via a minimal hand-rolled `.env` parser in `main.go`, since
  no dotenv dependency was added for one variable) — the DVM won't start
  without it. Verified end-to-end with a real API call: published a
  `kind:5001` job request with real text, confirmed `kind:7000` "processing"
  feedback and a `kind:6001` result containing a genuine, accurate Claude
  summary. (An apparent double-delivery of the feedback event during
  testing turned out to be the diagnostic script not deduping identical
  `EVENT` frames over the wire — normal, allowed relay behavior; only one
  real API call was made. Real clients, including this project's own
  `Feed.tsx`, already dedupe by event ID for exactly this reason.)
- **The DVM is payment-gated** (`server/cmd/dvm/nwc.go` +
  `requirePayment`/`loadPaymentConfig` in `main.go`) via a hand-rolled Go
  NIP-47 (NWC) client — mints a real invoice through the DVM operator's own
  receiving wallet (`make_invoice`), publishes it as a `kind:7000`
  `payment-required` feedback event with an `amount` tag
  (`[msats, bolt11]` per NIP-90), then polls `lookup_invoice` every 3s for
  up to 2 minutes before either proceeding (summary published normally) or
  giving up with an `error` feedback. **Set `NOSTRAS_DVM_NWC_URI`** (a
  `nostr+walletconnect://` string for a wallet *you* control that can mint
  invoices) **in `nostras.env` to enable gating** — unset, or unreachable
  at startup, and the DVM degrades to free mode with a warning rather than
  refusing to start. Optional `NOSTRAS_DVM_PRICE_SATS` (default 21).
  Verified end-to-end against a disposable mock wallet (fake keys, fake
  invoice, auto-"settles" 5s after `make_invoice` to simulate a real
  payment): confirmed `payment-required` fires immediately with the
  correct amount, the summary is genuinely withheld until the mock
  reports `settled_at`, and only then does `processing` -> a real
  Claude-generated `kind:6001` result follow. The negative path (payment
  never arrives -> `error` after the 2-minute window) was not live-timed
  given the wait, but is the same simple deadline-loop code already
  exercised on the success path — verified by review, not by a live run.
  **Evaluated and declined for now**: a related external project
  (`github.com/llmops-pro/search-service`) offers paid web search, but
  over L402/HTTP rather than NIP-90/Nostr, and is explicitly a "v0
  scaffold, not production-hardened" per its own README — integrating it
  now would mean bridging two different payment/transport protocols and
  pulling in a live, real-money, stranger-facing service before this
  project has any of that maturity itself. Worth revisiting later as a
  NIP-90 search job (kind 5302) that reimplements the same idea
  (SearXNG backend) natively in Nostr events instead of L402, not as a
  direct integration of that repo.

## Key decisions already locked (see strategy doc for full reasoning)

- **Key custody: bring-your-own, permanently — decided final, not open
  for revisit.** No hosted NIP-46 bunker, no bundled Lightning wallet, ever
  planned. The client only implements the *client* side of NIP-46
  (external signer, e.g. Amber) and NIP-47/NWC (external wallet, e.g.
  Alby, Mutiny) — it never holds custody of keys or funds anywhere in the
  system. This was originally gated behind a legal/liability review; on
  review there was nothing to resolve, since nothing in the actual
  architecture holds custody of anyone else's keys or funds — not client
  zapping (user's own wallet pays directly) and not the DVM receiving
  payment for its own service (ordinary commerce, not custody of someone
  else's money). The only thing ever gated was a *hypothetical* optional
  convenience tier (hosting a bunker/wallet on users' behalf) that was
  never built. Only reopen this if the architecture itself changes to
  introduce real custody (e.g. escrow, a hosted signer acting on a user's
  behalf) — nothing currently planned does that.
- **Relay choice: khatru.**
- **Build order is phased** (MVP → security/mobile UX → performance/
  retention → monetization) — see the roadmap section of the strategy doc.
  All four phases are now done.

## Conventions

- Nostr NIP numbers are the shared vocabulary for features in this repo —
  reference the NIP number in code/commits when implementing
  protocol-defined behavior (e.g. "NIP-57 zap request handling") rather
  than inventing internal names for protocol concepts.
- Once `client/` or `server/` gain real code, add a subdirectory
  `CLAUDE.md` in each for stack-specific instructions (commands, style)
  instead of growing this root file indefinitely.
