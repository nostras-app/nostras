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
  and Node — both get a `503` on the WS handshake), so the actual
  fetch-from-a-real-relay behavior could not be verified from inside this
  environment. What *was* verified here: it builds and vets cleanly, and
  the local-store path (query with an `Authors` filter, no aggregation
  needed) still works correctly with no regression. The remote-fetch path
  should be checked against a real deployment (the user's own machine or
  a server with normal internet access), where this restriction won't
  apply.

## Key decisions already locked (see strategy doc for full reasoning)

- **Key custody: bring-your-own, indefinitely.** No hosted NIP-46 bunker,
  no bundled Lightning wallet. The client only implements the *client* side
  of NIP-46 (external signer, e.g. Amber) and NIP-47/NWC (external wallet,
  e.g. Alby, Mutiny) — it never holds custody of keys or funds. Revisiting
  this requires an explicit legal/liability review, not a default change.
- **Relay choice: khatru.**
- **Build order is phased** (MVP → security/mobile UX → performance/
  retention → monetization) — see the roadmap section of the strategy doc
  before jumping ahead to later-phase features (NIP-90 DVMs, outbox
  aggregation, search) in `client/` or `server/` code.

## Conventions

- Nostr NIP numbers are the shared vocabulary for features in this repo —
  reference the NIP number in code/commits when implementing
  protocol-defined behavior (e.g. "NIP-57 zap request handling") rather
  than inventing internal names for protocol concepts.
- Once `client/` or `server/` gain real code, add a subdirectory
  `CLAUDE.md` in each for stack-specific instructions (commands, style)
  instead of growing this root file indefinitely.
