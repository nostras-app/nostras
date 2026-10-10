# Licensing

NOSTRAS (the client in `client/`, the relay and DVM in `server/`, and the
agent in `agent/`) is copyright © 2026 Mauro Moro and is available under
two licenses.

## 1. GNU Affero General Public License v3.0 (AGPL-3.0-only)

The full text is in [`LICENSE`](LICENSE). You can use, study, modify and
redistribute NOSTRAS for free under its terms. The one condition people
usually ask about: if you run a modified version as a network service
(for example, a hosted relay or a rebranded web client), you must offer
your users the source code of that modified version under the same
license.

## 2. Commercial license

If you want to use NOSTRAS without the AGPL's obligations, for example to
ship a rebranded or white-label build without publishing your changes, a
commercial license is available. Contact **hello@nostras.app**.

## Third-party code

- `server/internal/khatrufork/` is a modified copy of
  [fiatjaf/khatru](https://github.com/fiatjaf/khatru), released into the
  public domain under the Unlicense (see its `LICENSE`).
- `server/internal/eventstorefork/` is a modified copy of
  [fiatjaf/eventstore](https://github.com/fiatjaf/eventstore), also under
  the Unlicense (see its `LICENSE`).
- Dependencies installed through npm and Go modules keep their own
  licenses.

## Contributions

To keep both licenses possible, contributions are accepted under the terms
in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Trademark

The AGPL covers the code, not the name. "NOSTRAS" and its logo identify
the official project and service. Please give forks a different name.
