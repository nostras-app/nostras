# Contributing to NOSTRAS

Thanks for helping. Bug reports, NIP-conformance issues and pull requests
are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree
  on the approach.
- Protocol behaviour should follow the NIPs. Reference the NIP number in
  code comments and commit messages (for example "NIP-57: …").
- Never commit secrets: no nsec, no `nostr+walletconnect://` string, no API
  key. Use throwaway keys for testing.

## Development

- Client: `cd client && npm install && npm run dev`
- Relay: `cd server && go run .` (listens on `:7777`)
- DVM: `cd server && go run ./cmd/dvm` (needs `NOSTRAS_ANTHROPIC_API_KEY`)

Before opening a pull request, run `npm run build` and `npx oxlint` in
`client/`, and `go build ./... && go vet ./... && go test ./...` in
`server/`.

## License of your contribution

NOSTRAS is offered under the AGPL-3.0 and, separately, under a commercial
license (see [`LICENSING.md`](LICENSING.md)). For that to keep working,
every contribution needs both permissions. By opening a pull request you
confirm that:

1. you wrote the contribution, or otherwise have the right to submit it;
2. you license it under the AGPL-3.0-only; and
3. you grant Mauro Moro a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable license to use, modify, sublicense and distribute your
   contribution as part of NOSTRAS under other license terms, including
   the commercial license.

You keep the copyright in your contribution. Add a `Signed-off-by:` line
to each commit (`git commit -s`) to record this agreement.
