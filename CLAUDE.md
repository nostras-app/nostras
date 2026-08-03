# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Nostr PWA client paired with a self-hosted Nostr relay/node, distributed
without app stores. The client is the trust-neutral, protocol-native piece;
the relay/node is where differentiated services (search, aggregation,
notifications, DVMs) get delivered, implemented as standard NIPs wherever
possible rather than proprietary APIs.

Full rationale, the NIP-by-NIP service brainstorm, the phased build roadmap,
and all decisions made so far live in `@nostr-client-node-strategy.md` —
read it for the "why" before making architectural changes.

## Status

Pre-code / greenfield. `client/` and `server/` are empty scaffolding
directories — there are no build, test, or lint commands yet. Do not assume
any tooling exists until it's actually added; check for a `package.json` /
`go.mod` before running package-manager commands. This repo is not yet a
git repository.

## Architecture

- `client/` — the PWA. Planned stack: React + Vite + `vite-plugin-pwa`
  (Workbox-based service worker/installability) + NDK (Nostr Dev Kit) for
  relay pool management, event caching, and signer abstraction.
- `server/` — the relay/node. Planned stack: [khatru](https://github.com/fiatjaf/khatru)
  (Go relay framework), chosen over binary relays like `strfry` because
  later roadmap phases need to intercept/rewrite `REQ` filters in code
  (NIP-65 outbox aggregation, NIP-50 search) rather than configure a
  black-box binary.

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
