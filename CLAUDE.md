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

Phase 0 (MVP) scaffolding is in place in both `client/` and `server/`, but
neither has real feed/relay behavior yet — just proof the stack connects
end to end. Check `client/package.json` / `server/go.mod` before assuming a
command exists.

## Architecture

- `client/` — the PWA, package name `nostras`. React + Vite + TypeScript,
  `vite-plugin-pwa` (Workbox-based service worker/installability, manifest
  under the NOSTRAS name), `@nostr-dev-kit/ndk` for relay pool management,
  event caching, and signer abstraction. Bootstrap relay list lives in
  `client/src/lib/ndk.ts` (`ws://localhost:7777` placeholder for the local
  khatru node + a couple of public relays for dev). Run with `npm run dev`
  from `client/`.
- `server/` — the relay/node. [khatru](https://github.com/fiatjaf/khatru)
  (Go relay framework), chosen over binary relays like `strfry` because
  later roadmap phases need to intercept/rewrite `REQ` filters in code
  (NIP-65 outbox aggregation, NIP-50 search) rather than configure a
  black-box binary. Storage is the `badger` eventstore backend (pure Go, no
  cgo) writing to `server/data/` (gitignored). Listens on `:7777`. Run with
  `go run .` from `server/`.

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
