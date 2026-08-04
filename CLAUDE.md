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

**Rich note rendering and engagement (2026-08-04)**: raw content used to
show image/video URLs as plain text, which is why the feed looked
unpolished. `client/src/lib/parseContent.ts` splits note content into
text/link/image/video/audio segments by extension-sniffing URLs (not NIP-92
`imeta` tags — simple and broad-compatibility over precise), and
`client/src/components/NoteContent.tsx` renders media inline (images/video/
audio as real elements, not raw links) and truncates long notes (>400
chars) with a show more/less toggle. **NIP-23 long-form articles (kind
30023) are explicitly out of scope** — deliberate choice, not an oversight;
only kind:1 truncation was requested for this pass.

`client/src/components/EngagementBar.tsx` adds like (NIP-25, kind 7,
content `"+"`), repost (NIP-18, kind 6, content = stringified original
event via `event.rawEvent()`), and reply (kind 1 with a NIP-10
`["e", id, "", "reply"]` tag) — all via `client/src/hooks/useEventCount.ts`
(generic count of a given kind tagging a note, reused for all three) and
all publishing through `devPublishRelaySet` like everything else, so
liking/reposting real public content during dev never broadcasts to the
public network. Reply opens an inline composer; there's no threaded
display of actual replies yet, just a count — replies still show up in the
main feed as ordinary kind:1 notes since the Feed subscribes to all of
them. "Liked"/"reposted" state is session-local only (not derived from
existing reactions on reload), so a refreshed page won't show a
prior-session like as already-applied — a known simplification, not a bug.

Verified end-to-end against real live public-relay content: confirmed
real images/video (e.g. `blossom.primal.net` URLs) render inline instead
of as raw text, and published a real like/repost/reply through the UI,
confirming each landed on the local relay with correct
NIP-25/NIP-18/NIP-10 tag shapes.

**General UI polish pass (2026-08-04)**: the earlier design pass got the
app functional but it still read as "default Vite app," not a real
client — no visual identity, no timestamps, emoji-based icons with known
cross-platform rendering issues, and a truncated-note bug where URLs in
collapsed long notes showed as raw unshortened text (only the expanded
view ran them through `parseContent.ts`). Direction (Nostr-native/
purple-branded vs. Twitter-like vs. minimal-editorial) was an explicit
user choice — user picked Nostr-native/purple. `client/src/index.css`
gained `--accent-2`, `--accent-glow`, `--accent-gradient` (violet→pink,
both light/dark sets) used for the gradient wordmark
(`background-clip: text`), primary buttons, and avatar-fallback
backgrounds. `client/src/components/icons.tsx` is a new small set of
hand-written inline SVG icons (reply/repost/heart/zap/settings,
`currentColor` stroke, `filled` prop for active states) replacing every
emoji in `EngagementBar.tsx`, `ZapButton.tsx`, and the header settings
gear in `App.tsx` — fixes the emoji-rendering-inconsistency issue found
during the previous pass's verification, not just a cosmetic swap.
`client/src/lib/time.ts` adds `formatRelativeTime()` (built on
`Intl.RelativeTimeFormat`, no new dependency) and `Feed.tsx` now shows it
next to each author name — timestamps didn't exist at all before this.
`NoteContent.tsx` was restructured around a `truncateSafely()` helper
that cuts at the last whitespace before the 400-char limit and then runs
the *safe* slice through the same `parseContentSegments()` path used for
expanded notes, so link chips render correctly in both the collapsed and
expanded states — this replaced the old two-branch component (one path
for plain-text truncation, one for full parsing) with a single path,
fixing the bug and removing duplication at the same time. Media stays
hidden until a truncated note is expanded (preserved from before,
intentional — don't load heavy content the reader hasn't opted into).
`Composer.tsx` now shows the active signer's own avatar next to the
input (via `useActiveUser` + `useProfile`, the same reactive-cache hooks
used elsewhere) instead of a bare textarea. `Feed.tsx` also gained a
loading skeleton (driven by the subscription's `eose` event, so "no
notes yet" only renders once relays have actually finished their initial
reply — before that it's a pulse-animated skeleton) and a friendlier
empty state. Verified in-browser: desktop and a 390×750 mobile viewport
(no overflow), both light and dark palettes (dark is the live OS
setting; light was checked by temporarily forcing the light token values
via injected CSS, since there's no in-app theme toggle to switch OS
preference from a script), like/reply interaction states, the settings
panel, and real inline media (image) rendering with the new fade-in/
border/max-height treatment — all against live public-relay content, no
mock data.

**Bookmark, seen-on-relays, translate, note menu (2026-08-04)**: four
more icons matching a reference layout the user provided. Bookmark
(`client/src/hooks/useBookmark.ts`) is a real NIP-51 kind:10003 list —
fetches the active user's existing list, toggles this note's `e` tag,
republishes the whole list via `devPublishRelaySet`, same replaceable-list
pattern reused for the mute list below. "Seen on N relays" reads NDK's
`event.onRelays` (populated by NDK's own dedup tracking as duplicate
copies of the same event arrive from different relays in the pool) —
`Feed.tsx` re-renders on the subscription's `event:dup` so the count
keeps growing after the initial render instead of freezing at 1.

Translate is a **real NIP-90 DVM job** (kind 5002 → 6002), not a stub —
the DVM server binary (`server/cmd/dvm/main.go`) was extended to dispatch
by request kind instead of hardcoding summarization: `handleJob` now
picks `summarize` or `translateText` (a second Claude API call, same
pattern as summarization, target language read from a
`["param","language",<ISO-639-1 code>]` tag, mapped to an English name via
a small `languageNames` table since Claude follows a name better than a
bare code) and `publishResult` takes the result kind as a parameter
instead of assuming 6001. `client/src/lib/dvm.ts` is the client half of
the same protocol — publishes the job request, subscribes to
`[7000, resultKind]` tagging it, and reports
processing/payment-required/done/error, reusing the exact tag shapes
(`status`, `amount` as `[msats, bolt11]`) the server already emits for
summarization. **Important protocol detail found during verification**:
the job request sends the note's `content` directly as a NIP-90 `"text"`
input (`["i", text, "text"]`), not an `"event"` input pointing at the
note's id — an early version pointed at the id and failed with "could not
find referenced event" for most of the feed, because most notes arrive at
the browser straight from the public relays in the pool and were never
published to the local relay the DVM queries against. Sending content
directly needed no server change, since the server's `"event"` handling
was always the special case, not the default. `TranslateButton.tsx`
reuses the exact NWC invoice/pay-with-wallet UI pattern from `ZapButton`
for the payment-required path. Verified end-to-end for real: a live
Japanese note translated to Spanish via the actual Claude API, in free
mode (no `NOSTRAS_DVM_NWC_URI` set in this environment) — the payment-gated
path itself was already proven correct in the earlier DVM work and wasn't
re-exercised here.

`NoteMenu.tsx` is the three-dot dropdown: copy event ID / user ID (npub)
/ share link (`event.encode()` → `https://njump.me/<nevent>`) / note
content are pure clipboard actions; "view raw event" shows
`event.rawEvent()` as pretty-printed JSON; "report" publishes a real
NIP-56 kind:1984 event with an NIP-56 reason type
(`["e", id, reason]` / `["p", pubkey, reason]`) picked from a
spam/nudity/profanity/illegal/impersonation/malware/other list; "mute
user" is a real NIP-51 kind:10000 list edit, same fetch-then-republish
pattern as bookmarks. All publish through `devPublishRelaySet`. Every
action here — bookmark toggle, mute, and report reason selection — was
verified by round-tripping through the actual local relay (`nak req`)
and checking the resulting event's tags, not just the UI state. Known
simplification, consistent with likes/reposts elsewhere: bookmarked/muted/
reported state isn't pre-loaded against the existing list on first
render, only updated locally once the user actually interacts with a
given note's controls.

**Zap icon unification + single-row engagement controls (2026-08-04)**:
zap was the only engagement control still a filled pill with a text label
("Zap"), inconsistent with the ghost-icon-button treatment everywhere
else. `ZapButton.tsx`'s idle state now uses the same `engage-btn` class as
the others (icon + sats count only, no "Zap" text — matches how like/
repost/reply show their counts). The two-row engagement layout (primary
row + a bordered secondary row) was also collapsed into a single row per
user request — all 8 controls (reply, repost, like, zap, bookmark,
seen-on-relays, translate, menu) now sit on one line
(`.engagement-row` — `flex-wrap: wrap`, `position: relative` so the
translate/note-menu panels still anchor correctly, reduced `gap`). The
now-unused `.zap-pill`/`.engagement-row-secondary`/`.engagement-group`
CSS was removed.

**Header brand centering (2026-08-04)**: the header used
`justify-content: space-between` (wordmark left, status/gear right); per
user request it's now a 3-column grid (`minmax(0,1fr) auto
minmax(0,1fr)`) with an empty spacer div as the first column, so the
brand block (`.brand` — the existing `/favicon.svg` lightning-bolt icon
next to the "NOSTRAS" wordmark) stays exactly centered regardless of how
wide the status-pill+gear group on the right is. `minmax(0, …)` on the
flanking columns (not bare `1fr`) is what makes this work — plain `1fr`
tracks still respect each column's content-based minimum width, which
would pull the center off-true since the right column has real content
and the left one doesn't.

**Ask Claude — NIP-90 text generation (2026-08-04)**: a third DVM service
alongside summarization and translation, this time a free-form "ask
anything" box. Per the NIP-90 kind registry this is job kind 5050 →
result kind 6050 ("Text Generation"), added to `server/cmd/dvm/main.go`
the same way translation was — a `generateText` Claude call with a
minimal system prompt, dispatched from the same `handleJob` switch, so
it automatically inherits the shared payment-gating path. No new
protocol code was needed client-side either: `client/src/lib/dvm.ts`'s
`requestDvmJob` was already generic enough to reuse as-is.
`client/src/components/AskClaudeCard.tsx` is a new always-visible card
(not an icon-triggered popover like translate) rendered in `App.tsx`
directly below the composer — a circular avatar with a hand-drawn
four-point sparkle glyph (`SparkleIcon` in `icons.tsx`; deliberately
generic, not a reproduction of Anthropic's actual trademarked logo) in
Anthropic's brand orange (`--anthropic` token in `index.css`), a
textarea, a "Model: claude-opus-5" caption directly under it (that
string just mirrors the server's `dvmModel` constant — it's a display
label, not something the client actually negotiates), and an "Ask
ANTHROP\C" button in the same orange, styled per the user's own
reference. Same processing/payment-required/done/error states as
`TranslateButton`. Verified end-to-end twice: once directly via `nak`
against kind 5050/6050 (confirmed the DVM's subscription filter and job
dispatch actually picked up the new kind — an earlier restart attempt
left a stale build running, caught by testing the actual behavior rather
than trusting the process list), and once through the real UI asking
"what is the Nostr protocol?", which returned a genuine, accurate Claude
answer.

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
