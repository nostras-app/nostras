# NOSTRAS

A non-custodial Nostr client (installable PWA) paired with its own relay and
a paid NIP-90 Data Vending Machine. Bring your own signer (NIP-46/NIP-07),
bring your own Lightning wallet (NIP-47); NOSTRAS never holds keys or funds.

- App: https://app.nostras.app
- Relay: `wss://nostras.app`
- Docs and support: https://github.com/nostras-app/nostras

## Repository layout

| Path | What it is |
|---|---|
| `client/` | React + Vite + TypeScript PWA, built on NDK |
| `server/` | khatru relay (Go): NIP-50 search, NIP-65 outbox aggregation, NIP-29 groups, Web Push, and more |
| `server/cmd/dvm/` | NIP-90 DVM: summarize, translate, ask, spam check (encrypted, on Claude or your own models), paid content unlock, group joins, DAO tallies |
| `agent/` | Optional local daemon that takes tasks by NIP-17 DM |

See [`CONTRIBUTING.md`](CONTRIBUTING.md) to run it locally, and
[`docs/local-ai.md`](docs/local-ai.md) to run the DVM's AI jobs on your own
models (Ollama or any OpenAI-compatible server) instead of a hosted API.

## License

AGPL-3.0-only, with a commercial license available. See
[`LICENSING.md`](LICENSING.md).
