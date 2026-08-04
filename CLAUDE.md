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

**DVM payment gating verified against a real wallet (2026-08-04)**: the
payment-gated path had only ever been exercised against a disposable mock
wallet before now. The user connected a real NWC-capable wallet, scoped
to exactly the two permissions the DVM code actually uses — `Create
invoices` and `Lookup status of invoices`, nothing else (no balance read,
no send) — set `NOSTRAS_DVM_NWC_URI` in `nostras.env` themselves (never
typed into chat or read by Claude directly), and the DVM was restarted to
pick it up (startup log now reads `payment gating: ON — 21 sats per
job`, confirming the wallet connection succeeded). A real job was
triggered through the Ask Claude card, producing a real invoice
(`lnbc210n...` — 210 nano-BTC = 21 sats, matching the configured price
exactly); the user paid it themselves via their own wallet action —
**Claude never touches `payInvoiceWithNwc` or any payment-sending step,
only the job-request and invoice-display side**, consistent with the
project's standing financial-safety rule. Verified correct by querying
the relay directly for the full event sequence rather than trusting the
UI alone: `payment-required` at t+0, `processing` at t+118s (the DVM's
3s poll loop only flips to processing once `lookup_invoice` reports
`settled_at`, and 118s is genuinely how long the human took to pay — not
a bypass), then the real `kind:6050` result 5s later. This is the first
time any part of this project has moved real money end-to-end, and it
worked correctly on the first real attempt.

**DVM job pricing is now proportional to real API cost, not flat
(2026-08-04)**: previously every job cost a flat `NOSTRAS_DVM_PRICE_SATS`
(21) regardless of how long the question/text was. `handleJob` now calls
`estimateJobCostSats` before minting the invoice, which uses Anthropic's
real `count_tokens` endpoint (`claude.Messages.CountTokens` — free to
call, runs no inference) to get the *exact* input token count, adds a
typical-case assumption for the un-knowable output length
(`estimatedOutputTokens = 500`, a user-confirmed design choice — see
below), prices both sides against Opus 5's real per-token rates
(`inputPricePerMillionUSD`/`outputPricePerMillionUSD`), and converts
USD→sats via a live BTC/USD rate (`fetchBTCUSDRate`, CoinGecko's public
`simple/price` endpoint, no API key, 5s timeout). Falls back to the flat
`NOSTRAS_DVM_PRICE_SATS` if either the token count or the rate lookup
fails — same degrade-gracefully philosophy as `loadPaymentConfig` itself.
**Output length can't be known before generation runs — that's inherent
to how LLMs work**, so this is deliberately an *estimate*, not an exact
price; the three options considered (worst-case using the 2048 `MaxTokens`
cap, a typical-case ~500-token assumption, or input-only ignoring output
entirely) were presented to the user, who picked typical-case as the best
balance of "actually proportional" vs. "not stuck near the cap for every
job." One side effect worth remembering: because the fixed output
assumption dominates cost for short questions, most short prompts price
within a narrow band regardless of exact length — the input-token
contribution to price only becomes visible for genuinely long inputs
(a full paragraph or more). This was verified as real behavior, not a
bug: a 2-word prompt priced at 21 sats and a ~1400-word prompt priced at
39 sats in the same test run, via `nak` directly against the running DVM
with the real wallet temporarily re-enabled (then restored to the free
mode the user had it in) — confirmed via the actual `amount` tag on the
`payment-required` event, not just trusting the log. This refactor also
consolidated the three near-identical `summarize`/`translateText`/
`generateText` functions into one `callClaude(ctx, claude, systemPrompt,
userText)` helper, since the per-job system prompt now needs to be a
reusable value (used for both the cost estimate and the actual
completion call) rather than being hardcoded inside three separate
functions.

**Unrelated but noteworthy from this same session**: the local relay
process died on its own between tool calls (not from anything that
explicitly targeted it — every kill in this session was verified by PID
against `ps`/`lsof` immediately beforehand, and the relay was confirmed
still listening after each one, until it simply wasn't). Restarted
cleanly with `go run .` from `server/` — badger reopened its existing
tables with no data loss. Worth knowing if a "connection refused" shows
up unexpectedly in this local dev environment: check `lsof -i :7777
-sTCP:LISTEN` first, it may just need a restart, not deeper debugging.

**Ask Claude card cosmetic follow-up (2026-08-04)**: three small fixes to
the card described above, all user-requested after seeing it live. The
button label changed from the stylized "Ask ANTHROP\C" to plain "Ask
Claude". `SparkleIcon` in `icons.tsx` is now an eight-point burst (two
copies of the original four-point path, one rotated 45° via SVG
`transform`) instead of four, matching a reference image more closely —
still deliberately generic artwork, not a reproduction of Anthropic's
actual logo. Both `TranslateButton.tsx` and `AskClaudeCard.tsx` now show
"you are paying **N sats**" next to the invoice in the payment-required
state (parsed from the same `amountMsat` the DVM already sends, just not
displayed before) — the invoice text alone doesn't make the amount
legible to a user. All three verified in-browser, including the sats
display (temporarily re-enabled the real wallet from the entry above
to see a real `payment-required` state, confirmed "21 sats" matched the
invoice's actual `lnbc210n...` amount, then restored free mode).

**Left nav rail replaces the stacked single-column layout (2026-08-04)**:
the user pointed at a reference (Bluesky's desktop icon rail) and asked
for the same pattern — a persistent slim vertical icon bar, clicking an
icon makes that "blob" (view) fill the screen instead of everything
being stacked in one long scroll. `client/src/components/NavRail.tsx` is
the new rail: Home, Ask Claude (`SparkleIcon`, orange `--anthropic`
active color), Settings, and a highlighted Compose (pencil, always-on
accent-gradient background — it's the primary action, not just another
icon) are real and wired up; Notifications/Messages/Search/Profile/
Bookmarks render `disabled` with a "coming soon" tooltip — a deliberate
choice (confirmed with the user first) to visually match the full
reference icon set without shipping dead functional UI, since NOSTRAS
doesn't have notifications, DMs, search UI, or a profile page yet. (A
dedicated "view all my bookmarks" screen doesn't exist either, despite
the per-note bookmark *action* already existing — that would be new
work, not just nav wiring, so it's disabled too for now.)

`App.tsx` now tracks a single `activeView` (`'home' | 'compose' |
'ask-claude' | 'settings'`) and every view's section gets a
`view-panel`/`view-panel-active` class pair instead of being
conditionally rendered — **all views stay mounted, only hidden via CSS**,
specifically so switching away and back doesn't lose state: a half-typed
Ask Claude question, the feed's live subscription and loaded events, an
open zap/translate panel, all survive a nav switch. This was verified
directly (typed into Ask Claude, switched to Settings and back, text was
still there) not just assumed. **CSS ordering gotcha hit while building
this**: `.view-panel`/`.view-panel-active` were originally defined near
the top of `App.css`, before `.settings-panel`'s own `display: flex`
rule — since both have equal class-selector specificity, the
later-defined rule wins a tie, so `.settings-panel` was silently
overriding the hide/show toggle. Fixed by moving the view-panel rules to
the very end of the file (with a comment explaining why), which
guarantees they win any future equal-specificity conflict too, not just
this one.

Layout-wise, `.app` is now a flex row (rail full-height on the left,
sticky, `align-self: flex-start` + `height: 100svh` — the standard
sticky-sidebar-next-to-a-row pattern, doesn't depend on guessing the
header's pixel height) with `.app-content` (header + main) filling the
rest. The header's old settings gear button was removed — that's the
rail's job now — leaving just the centered brand + connection pill.
Verified on both desktop and a narrow (~556px, this environment's
practical resize floor when it cooperates — see below) viewport: rail
fits, no horizontal overflow, disabled icons are inert (confirmed via
DOM state, not just visual graying), Home/Compose/Ask Claude/Settings
all switch correctly and only one `view-panel-active` exists at a time.

**Environment flakiness noted while verifying this (not a code issue)**:
the browser automation tab group was lost mid-session and had to be
recreated; the new tab then ignored several `resize_window` calls
(reporting success but `window.innerWidth` never changed) until a
freshly-created tab in the same group finally responded. If a mobile
check ever seems to silently not apply, verify with
`window.innerWidth` via JS rather than trusting the resize call's
success message alone.

**Search UI landed, filling in the rail's last disabled-until-now icon
(2026-08-04)**: `client/src/components/SearchView.tsx` — a text input +
"Search" button (submit on Enter or click), reusing NIP-50 search
(`server/search.go`) which was already implemented server-side but never
had a client. Queries via `ndk.fetchEvents({kinds:[1], search: query},
opts, localRelaySet)`, scoped to the local relay only via a renamed/
reused export (`localRelaySet` in `lib/ndk.ts` — same relay set
`devPublishRelaySet` already pointed at, now exported under both names
since it's used for reads here too) because NIP-50 isn't guaranteed on
the public bootstrap relays and is only actually indexed locally anyway.
Results reuse `FeedItem` from `Feed.tsx` (now exported) so search results
look identical to feed notes — same avatar/content/engagement bar, no
separate rendering path to maintain. States: idle (prompt), loading,
results, empty ("no results for ..."), error. An honest caption under
the input says search only covers notes that touched the local relay,
matching the documented gap (outbox-aggregated/public-relay-only content
isn't indexed).

**Real bug caught during verification, not shipped**: the first version
returned an extra, wrong result alongside the correct match — searching
"zorblatt" (a word planted in exactly one test note) also returned an
unrelated bot join-spam note. Direct `nak req --search zorblatt` against
the relay confirmed the *server* only ever returns the one correct
match — the bug was client-side: NDK's default fetch is cache-aware, and
its cache doesn't implement full-text search, so it was matching cached
kind:1 events on structural fields alone (kind) and blending them into
the results regardless of the `search` term. Fixed by passing
`{ cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY, closeOnEose: true }`
to force the query to skip the cache entirely. **Takeaway for any future
`fetchEvents`/`subscribe` call using a filter field NDK's cache can't
interpret (like `search`) — always pass `ONLY_RELAY`**, or verify
against the relay directly (`nak req`) rather than trusting that a
client-rendered result list reflects real relay behavior.

**Profile view landed, the nav rail's last remaining piece from the
original ask (2026-08-04)**: per the user's own reference, their avatar
now sits at the very top of the rail, above Home, instead of a generic
disabled person icon in the middle — `NavRail.tsx` calls
`useActiveUser`/`useProfile` itself to render it (real picture, or a
gradient-fallback circle with `UserIcon` while the picture is missing/
loading). Clicking it opens `client/src/components/ProfileView.tsx`: a
header card (avatar, name, click-to-copy npub, about) above a feed of
*only that user's own notes*. The own-notes feed reuses `FeedItem` from
`Feed.tsx`, same as search results do. `client/src/hooks/useNoteFeed.ts`
is a new extraction — `Feed.tsx`'s subscribe/dedup/sort/eose/event:dup
logic pulled out so both the global feed and this author-scoped one
share it instead of diverging into two copies; `useNoteFeed(authors?)`
takes an optional pubkey array (omitted = global feed). Verified
end-to-end: the profile feed genuinely only shows this identity's own
past notes (confirmed against real notes published earlier in this same
session, not a mock), npub copy works, no overflow on mobile.

**Bookmarks view, the nav rail's 7th real icon (2026-08-04)**:
`client/src/components/BookmarksView.tsx` — fetches the active user's
kind:10003 list, reads the `e`-tag ids (**reversed**, since toggling
appends new bookmarks to the end of the tag array — showing
most-recently-bookmarked first is more useful here than sorting by each
note's own publish date), fetches those specific events across the
*full* relay pool (unlike search, no relay-set restriction — a
bookmarked note can be anywhere, not just the local relay), and renders
them with the same `FeedItem` every other view reuses. **Deliberately
refetches every time the tab becomes active**
(`<BookmarksView active={activeView === 'bookmarks'} />`), not just once
on mount — every view in this app stays mounted permanently (see the nav
rail entry above), so a one-shot fetch would go stale the moment a note
gets bookmarked or unbookmarked elsewhere while this tab sits in the
background. Verified end-to-end: bookmarked a note from Home, confirmed
it appeared first in Bookmarks; unbookmarked it, switched away and back,
confirmed it was gone — the refetch-on-activate behavior actually works,
not just the initial fetch. No new CSS needed, entirely reuses
`.feed`/`.feed-empty` from the existing feed views.

**Notifications view, the nav rail's 8th real icon — only Messages
remains "coming soon" (2026-08-04)**: user explicitly chose the simpler
scope (activity list only, no unread badge/count) over badge tracking
when asked, since a badge needs a persisted "last seen" timestamp and a
background-live subscription for real payoff.
`client/src/hooks/useNotifications.ts` subscribes to
`{kinds:[1,6,7,9735], '#p':[myPubkey]}` (replies/mentions, reposts,
likes, zap receipts — every kind this app's own engagement features
already produce), filtering out self-notifications client-side (Nostr
filters have no "NOT author" clause).
`client/src/components/NotificationsView.tsx` renders each kind with a
color-coded icon reusing the exact icons/colors `EngagementBar` already
established (pink heart, green repost, accent reply bubble, orange
zap bolt) so the visual language matches. **Zap amount parsing uses
NDK's own `zapInvoiceFromEvent`** (decodes the real bolt11 in the
receipt's `bolt11` tag) — real library code, not hand-rolled, and it
correctly returns `null` for anything it can't decode, which the
renderer falls back on gracefully (shows "zapped you" without an amount
rather than crashing). Verified with real published test events (a
throwaway key's real kind 1/6/7 events tagging a dev-identity note, via
`nak` — not mocked in memory) for the first three types; the zap type
specifically was verified via its *fallback* path (a real kind:9735
event with a deliberately garbage `bolt11` tag, since fabricating a
genuinely valid bolt11 to also test the happy path wasn't worth the
effort — NDK's own bolt11 decoder is well-established, not code this
project owns). No overflow on mobile confirmed via `scrollWidth`.

**Unrelated observation from this same verification pass**: a real,
long-preexisting minor issue — some notes with very long unbroken raw
JSON content (bot/automation notes that dump structured data as note
content instead of human text — common on the public relays this app
reads from) cause horizontal overflow on narrow viewports despite
`.feed-item-content` already having `overflow-wrap: anywhere` and the
flex chain already having `min-width: 0` at every level checked. Root
cause not yet isolated — flagged for a future pass, not fixed here since
it predates and is unrelated to today's notifications work.

**Client hardened to recover automatically from a local relay
restart (2026-08-04)** — directly prompted by the user hitting exactly
this while working (killed the relay from their own terminal to clear a
stale badger lock, restarted it, and the already-open tab stayed stuck
showing a loading skeleton forever). `client/src/lib/relayStatus.ts` is
new: tracks the *local* relay's connection health specifically (not
every relay in the pool) and exposes a `generation` counter that bumps
only on a genuine recovery (disconnected → connected, not the initial
connect). `client/src/hooks/useNoteFeed.ts` and `client/src/hooks/
useNotifications.ts` — the app's two long-lived live subscriptions —
both now depend on `generation`, so a relay recovery tears down the
stale subscription and sends a fresh `REQ`, instead of leaving one that
NDK never resends on its own. The header's status pill is layered with
a live "reconnecting" state (`App.tsx`) without touching the existing
one-time `state` gate that controls whether the shell renders at all —
a relay hiccup shouldn't hide content that's still usable, just say so
honestly instead of silently freezing on "connected".

**This took real live debugging to get right, not just code that looked
plausible** — worth recording in detail since the failure modes weren't
guessable from documentation alone:
1. First bug: compared `relay.url` to the bare `localRelayUrl` constant
   directly. NDK's `normalizeRelayUrl` always appends a trailing slash
   (`"ws://localhost:7777"` → `"ws://localhost:7777/"`), so the
   comparison silently never matched and the listeners never fired at
   all. Fixed by normalizing with NDK's own `normalizeRelayUrl` instead
   of hand-matching the format.
2. Second bug, found only by actually killing the relay process and
   watching a real browser tab for several minutes (this could not have
   been caught by reading NDK's source alone): NDK's own automatic
   reconnection **schedules retries that never fire** in this exact
   scenario. Confirmed live — inspected the relay's internal connectivity
   state mid-hang (`status: DISCONNECTED`, no `reconnectTimeout`
   pending, so nothing was queued to retry) and confirmed a *manual*
   `relay.connect()` call from that exact stuck state succeeded
   instantly. NDK's own silence-detection (a 2-minute keepalive + a 5s
   liveness probe) correctly *detects* the drop — the pill correctly
   showed "reconnecting" — but the retry *scheduler* it hands off to
   afterward just doesn't run. Fixed by having `relayStatus.ts` own a
   simple periodic retry (`relay.connect()` every 3s) once a disconnect
   is detected, rather than trusting NDK's internal scheduler.
3. Third bug, same live-test method: even after the module's own
   `relay.connect()` call resolved and `relay.connected` was genuinely
   `true`, the `"relay:ready"` event did not reliably fire again for a
   relay that had already been through one disconnect/reconnect cycle —
   so a status update that waited on that event stayed stuck showing
   "reconnecting" even after the underlying connection had actually
   recovered. Fixed by having the retry loop check `relay.connected`
   directly after each attempt instead of depending on the event; the
   event listener is kept too as a harmless redundant second path.

**Verified for real, end to end, three separate times** (the first two
runs each caught one of the bugs above): reload the app, confirm
"connected"; kill the relay process by exact PID; restart it
immediately so it's ready when the client notices; wait out the full
detection window (~2.5 minutes, no page interaction); confirm the pill
live-transitions "connected" → "reconnecting" → "connected" and fresh
notes actually render — all with **zero manual page refresh and zero
console commands**, purely from the running app noticing on its own.
Debugged via a temporary `window.__ndk`/`window.__relayStatus` hook to
inspect NDK's actual internal connectivity state directly rather than
guessing from behavior alone — removed before finalizing, not shipped.

**Scope note**: only `useNoteFeed`/`useNotifications` needed this —
`BookmarksView`/`SearchView` are one-shot fetches triggered by explicit
user action (opening the tab, submitting a search), not long-lived
subscriptions, so they don't have the "stale subscription never
resent" problem in the first place; a fresh fetch after the relay
recovers just works normally. Detection latency (~2 minutes worst case)
is NDK's own built-in silence-detection window, left as-is — legitimate
existing library behavior, not something this fix tried to speed up.

Check `client/package.json` / `server/go.mod` before assuming a command
exists.

**Relay management in Settings — status view landed, first of four planned
pieces (2026-08-04)**: user asked for relay management in Settings; scoped
into four pieces (status view, add/remove custom relays, per-relay publish
toggle, NIP-65 list editor), built one at a time per the usual workflow.
This entry covers the first. `client/src/lib/relayList.ts` is a new
module-level reactive store (same `useSyncExternalStore` pattern as
`useProfile`/`relayStatus.ts`) that snapshots `ndk.pool.relays` — the
*entire* live pool, not just the three explicitly configured relays —
recomputed on the pool's `relay:connecting`/`relay:connect`/`relay:ready`/
`relay:disconnect`/`relay:auth`/`relay:authed` events.
`client/src/components/RelaySettings.tsx` renders it as a status-dot +
URL + status-label list in the Settings panel, with the local relay
badged. **Verified live that the pool is genuinely dynamic**: NDK's
`useTemporaryRelay`/outbox-lookup machinery adds and later evicts relays
on its own as different authors' NIP-65 write relays get fetched during
normal feed use — watched the actual relay list in a live browser change
composition between two page loads without any user action, confirmed
this is expected NDK behavior (not a bug) via `NDKPool.useTemporaryRelay`
in the SDK's own type defs, and added an honest caption in the UI saying
so rather than presenting the list as a fixed configured set. Also added
`max-height` + scroll on the list since it can otherwise grow long.
Verified on desktop and a narrow (~500px, this environment's practical
resize floor — see the workflow-preference memory) viewport: no overflow,
ellipsis truncation on long URLs, scroll container works, live status
transitions (connected/connecting/disconnected) render correctly for both
the local relay and dynamically-discovered ones.

**Relay management, piece 2 — add/remove custom relays (2026-08-04)**:
`client/src/lib/customRelays.ts` is pure localStorage CRUD
(`nostras:custom-relays`, a JSON array of normalized relay URLs) with
deliberately no import of `ndk.ts` — `ndk.ts` imports `getCustomRelays()`
to seed `explicitRelayUrls` at construction time (so a reload reconnects
to previously-added relays automatically), and a one-directional import
would become circular if `customRelays.ts` imported back. Applying a
change to the *live* pool (`ndk.pool.getRelay(url, true)` /
`ndk.pool.removeRelay(url)`) happens in `RelaySettings.tsx` itself, which
imports both modules — no cycle since the component isn't imported by
either. **Protocol detail that mattered**: `NDKPool.removeRelay(relayUrl)`
does a direct (non-normalizing) map lookup, unlike `getRelay`/
`isRelayConnected` which normalize internally — so the URL passed to
`removeRelay` must already be normalized (`NDKRelay`'s own constructor
always normalizes `relay.url`, which is what's stored as the map key).
`customRelays.ts` normalizes on add and stores the normalized form, so
what's persisted always matches what `removeRelay` needs. `relayList.ts`
gained an exported `refreshRelayList()` for the same reason `markConnected`
doesn't fully trust events in the relay-hardening work: `removeRelay`
deletes its map entry and emits `relay:disconnect` in the same tick, and
relying solely on that event risked a stale snapshot depending on
listener-registration order — calling `refreshRelayList()` right after
the pool mutation sidesteps the ordering question entirely. Custom relays
get a "custom" badge (alongside the existing "local" one) and a remove
(×) button in `RelaySettings.tsx`; built-in and outbox-discovered relays
have neither. Verified end-to-end in a live browser: added a relay not
previously in the pool, confirmed it persisted to localStorage, connected
live, and was correctly badged; removed it and confirmed it disappeared
from both localStorage and the live pool (not just the "custom" badge);
reloaded the page after re-adding one and confirmed it reconnected
automatically from persisted state with zero re-entry; and confirmed the
invalid-URL and duplicate-add validation errors render via the existing
`.alert-error` convention. Custom relays are read-only additions to the
general pool, same as the two built-in public relays — publishing is
untouched by this piece, still hardcoded local-only (see the publish-target
toggle, planned as its own separate piece).

**Relay management, piece 3 — per-relay publish-target toggle
(2026-08-04)**: the user picked "opt-in per session, resets on reload" over
persisting the choice, specifically so a forgotten selection from a past
session can never silently broadcast dev/test notes to the public network
— this is a real risk this project has cared about since the very first
`devPublishRelaySet` decision (see the Architecture section below).
**`devPublishRelaySet` is now a SEPARATE `NDKRelaySet` instance from
`localRelaySet`** (`lib/ndk.ts`) — both start with just the local relay,
but `devPublishRelaySet.relays` (a real mutable `Set`, despite the
`readonly` TS annotation on the outer property — only reassigning the
property itself is blocked, not calling `.add()`/`.delete()` on the Set
it points to) gets mutated in place by the new `lib/publishTargets.ts`
when the user opts a relay in or out. This split matters: sharing one
instance would have leaked opt-in publish targets into `localRelaySet`,
which NIP-50 search reads depend on staying local-only forever. Because
`event.publish(devPublishRelaySet)` reads `.relays` fresh at call time,
**none of the 7 existing call sites needed to change**
(`Composer`/`EngagementBar`/`NoteMenu`/`useBookmark`/`ProfileEditor`/
`dvm.ts`) — mutating the shared Set in place is enough.
`publishTargets.ts` itself is session-only in-memory state (a `Set<string>`
of extra relay URLs, `useSyncExternalStore` pattern, reset to empty on
every module load i.e. every reload) — deliberately not localStorage, to
match the user's chosen safety default. `RelaySettings.tsx` gained a new
`UploadIcon` (`icons.tsx`) toggle button per relay row: pressed/accent
when that relay is an active publish target, disabled+always-pressed for
the local relay (can't be turned off), click toggles others on/off via
`togglePublishTarget`. **Verified without ever publishing a real note to
a public relay** (doing so would itself violate the safety property being
tested) — used the same temporary `window.__x` debug-hook technique from
the earlier relay-hardening work (`(window as
unknown as Record<string, unknown>).__devPublishRelaySet =
devPublishRelaySet` in `ndk.ts`, removed before finalizing) to inspect
`devPublishRelaySet.relays` directly: confirmed it start/reload at
local-only, confirmed toggling `wss://relay.primal.net/` on actually adds
it to the real Set NDK's `event.publish()` will read, confirmed toggling
off removes it again, and confirmed a real `Composer` publish with no
toggle applied still lands only on the local relay (checked directly via
`nak req` against `ws://localhost:7777`). The local relay's toggle button
was confirmed `disabled` in the live DOM, not just by code review.

**Relay management, piece 4 (final) — NIP-65 relay list editor
(2026-08-04)**: completes the four-piece relay-management feature.
`client/src/hooks/useNip65RelayList.ts` follows the exact
fetch-then-republish pattern as `useBookmark`/the mute list — fetches the
active user's kind:10002 event (unscoped relaySet, full pool, same as
bookmarks) and parses `["r", url, marker?]` tags into `{url, read,
write}` (no marker = both, `"read"`/`"write"` = one only). If no list
exists yet, seeds a sensible default (local relay, read+write) instead of
an empty editor. Saving builds a fresh kind:10002 event and publishes via
`devPublishRelaySet` — same session-scoped publish targets as everything
else (local-only by default; add relays as publish targets in the
section above it to actually get this list out to the public network).
`Nip65RelayListEditor.tsx` renders each entry with read/write checkboxes
and a remove button, plus the same add-relay input pattern (and
`isValidRelayUrl` validation) as the custom-relay section.

**Real layout-shift bug caught during verification, not a hypothetical**:
the live relay-pool list above this editor (RELAYS section) churns
constantly (relays connect/disconnect, temporary outbox-lookup relays
appear/vanish — see piece 1's entry). Its container originally used
`max-height` + scroll, which still let the box's *actual* height vary
with content below the cap, reflowing everything underneath — including
this editor's own checkboxes — while filling out the form. Caught this
for real: a scripted test clicked a checkbox by coordinate, the pool
list had changed size between locating and clicking, and the click
landed on the wrong relay's checkbox (`localhost:7777` lost its `read`
tag instead of the intended test relay). This would have hit a real user
the same way, not just a test script. **Fixed by changing `.relay-list`
(the RELAYS section) to a fixed `height` (not `max-height`) with
scroll**, so its box size never changes regardless of live pool churn —
documented inline in `App.css` since the reasoning isn't obvious from
the rule alone. The NIP-65 editor's own entry list uses a separate
`.nip65-list` class (no fixed height) since it's short and user-controlled,
not subject to the same churn. Redid the verification afterward driving
every interaction through direct DOM queries + `.click()` (matching
elements by text content) rather than fixed pixel coordinates, specifically
because the coordinate-based approach is what surfaced this bug — safer
against any remaining layout movement.

**Verified end-to-end for real** (not just checked in devtools state):
added a test relay, set it to write-only, saved, then queried the local
relay directly via `nak req -k 10002 -a <pubkey>` and confirmed the
published tags matched exactly: `[["r","ws://localhost:7777/"],["r","wss://
relay.nip65test.example/","write"]]` — correct NIP-65 shape, no marker
for the read+write local relay, `"write"` marker for the read-unchecked
one. Reloaded the page and confirmed the editor re-fetched and
correctly re-parsed this exact list (test relay showed `read: false,
write: true`), not the seeded default. Cleaned up afterward (removed the
test entry, saved again) and confirmed via `nak` that the dev identity's
list is back to just the local relay — `nak req -k 10002` alone returned
an unrelated real user's list from general relay traffic, a reminder that
kind queries need an explicit `-a <pubkey>` filter on a shared relay.

**Fly.io deploy prep (2026-08-04)**: NOSTRAS has a real domain now
(`nostras.app`, registered via EuroDNS, bundled with `nostras.tech` as a
defensive redirect target — see the support-site-plan memory) and a
public GitHub org (`github.com/nostras-app`) for docs/support only. This
entry covers making the server deployable to Fly.io per the hosting plan
already decided (see the Architecture section below) — the actual `fly`
account setup/deploy itself needs the user's own Fly login, not something
this session could do.

`server/main.go` and `server/cmd/dvm/main.go` had their previously
hardcoded local-dev values (badger/bluge paths, listen port, the DVM's
relay URL) made env-configurable, **with the exact same defaults as
before** when the env vars are unset — verified by restarting both the
relay and DVM locally after the change and confirming identical log
output/behavior to pre-change (`./data`, `./search-index`, `:7777`,
`ws://localhost:7777`), so local dev is unaffected. `client/src/lib/ndk.ts`'s
`localRelayUrl` now reads `import.meta.env.VITE_RELAY_URL` first, same
localhost fallback — verified in-browser that local dev still connects
correctly with no env var set. **The `localRelayUrl` name stays
`localRelayUrl`** even though in production it won't literally be
"local" — renaming it would touch a large number of call sites for a
purely cosmetic reason; the actual invariant it represents ("our own
relay" — dev-safe publish scope, NIP-50 search scope) is what matters,
documented inline at its definition.

`server/Dockerfile` is a multi-stage build producing both the `relay`
and `dvm` binaries from the one Go module, copied into a minimal Alpine
final image with no default CMD — `fly.toml`'s `[processes]` supplies
the actual command per process group. Not build-tested locally (this
sandbox's Docker daemon socket isn't accessible, `permission denied`) —
**built cleanly on Fly's remote builder on the very first attempt**, no
Dockerfile iteration needed.

`server/fly.toml`: one Fly app (name `nostras` — available on Fly, unlike
the `nostras` GitHub org slug), two process groups sharing the image —
`web` (the relay, the only one with an `[http_service]` block, so the
only one that gets a public IP/TLS) and `dvm` (no service block — no
public exposure, but still reachable from `web` over Fly's automatic
private networking). A Volume (`nostras_data`, 1GB, `fra` region) is
mounted at `/data` and scoped to the `web` process only via
`mounts.processes`, since badger and bluge are both single-writer,
single-process embedded stores — **this server cannot be horizontally
scaled** past one machine per process group without swapping to a
networked backend. `min_machines_running = 1` + `auto_stop_machines =
false` on `web`'s http_service, matching the decided shape.

## Fly.io deploy — live and verified end-to-end (2026-08-04)

`nostras.fly.dev` is live. Real issues hit and fixed during the actual
deploy, not just theoretical — worth remembering the specific failure
modes:

1. **First `fly secrets set` silently didn't apply** — `flyctl secrets
   list --app nostras` came back empty even after the user reported
   running it, twice. Root cause never fully confirmed (likely ran
   against the wrong app/shell context), but the fix was simple: rerun
   it and actually check `flyctl secrets list` afterward rather than
   trusting the command's own "success" framing — this is now the
   standard verification step for any future secrets change here.
2. **The DVM crash-looped 10 times and hit Fly's max-restart-count
   circuit breaker** before the secrets actually landed — confirmed via
   `flyctl logs --app nostras --machine <id>` (note: `flyctl logs`
   streams indefinitely and won't return in a single command; always
   wrap it in `timeout N` or it hangs a tool call). Every boot logged
   `NOSTRAS_ANTHROPIC_API_KEY not set`, exited 1, Fly restarted it, until
   `machine has reached its max restart count of 10` and it went to
   `stopped` for good — **a circuit-broken machine does not
   self-recover just because the underlying cause (missing secret) gets
   fixed later**; a fresh `flyctl secrets set` triggers a rolling config
   update but does NOT necessarily start a machine that's in this
   stopped state — had to `flyctl machine start <id> --app nostras`
   explicitly. **Rule for future secrets/config fixes on a
   previously-crash-looped machine**: after fixing the root cause, check
   `flyctl status` and manually start any machine still showing
   `stopped`, don't assume the config update alone brings it back.
3. **`ws://web.process.nostras.internal:7777` — the private-networking
   hostname flagged as unverified when this was written — is confirmed
   correct**, straight from the DVM's own boot log once it ran cleanly:
   `listening on ws://web.process.nostras.internal:7777` with no
   connection error, immediately followed by a successful real job
   round-trip (see below). No fallback needed.
4. **`NOSTRAS_DVM_NWC_URI` was initially set to something invalid** — the
   DVM logged `warning: NOSTRAS_DVM_NWC_URI set but could not connect,
   running free: invalid nostr+walletconnect:// URI` and degraded to free
   mode exactly as designed (no crash) rather than blocking the DVM
   entirely — likely the literal example placeholder text got submitted
   instead of a real wallet string the first time. **Fixed the same day**:
   user re-ran `flyctl secrets set` with the real value (confirmed via a
   changed secret digest, not just trusting the command's own success
   message), the `dvm` machine picked it up cleanly with no manual
   restart needed this time (unlike the API-key fix — this one didn't
   crash-loop, since an invalid NWC URI degrades gracefully rather than
   exiting).
5. The dashboard's "Proxy not finding machines to route requests" banner
   right after deploy was **stale/transient**, not a real problem — the
   relay was independently confirmed reachable via `curl -H "Accept:
   application/nostr+json" https://nostras.fly.dev/` (returned a valid
   NIP-11 doc) at the same moment the banner was showing.

**Full real end-to-end job verified against the live deployment**, not
just "processes are up": published a genuine `kind:5050` job ("What is
2+2?") to `wss://nostras.fly.dev` from this sandbox (confirming outbound
WSS works from here, unlike the raw local-relay `ws://` port that's
blocked — see the sandbox-network-limits memory) using a throwaway `nak`
keypair, watched a real `kind:7000` "processing" feedback event and then
a real `kind:6050` result with `content: "4"` — the actual Claude API
answer — come back through the full path: relay → DVM (over Fly private
networking) → Anthropic API → DVM → relay → back to the subscriber.
Also confirmed the standby `dvm†` machine stayed `stopped` throughout (no
duplicate job processing risk from Fly's automatic failover-standby
machine).

**Payment gating fully verified live in production, including a real
settled payment (2026-08-04)**: after fixing the NWC secret (item 4
above), triggered a fresh job and got a real `payment-required` (20
sats, a genuine bolt11 from the operator's actual wallet) instead of
skipping straight to processing — confirming the fix took. First attempt
at actually paying it timed out (`kind:7000` `error: "payment not
received in time"` at exactly the 2-minute `paymentWaitWindow` mark) —
the user's payment likely landed after the DVM had already given up
waiting, not a bug; same operator wallet on both ends so nothing was
actually lost, just a timing miss. **Second attempt, paid within ~30s,
succeeded completely**: `payment-required` → `kind:7000` `processing`
(detected real settlement via `lookup_invoice` polling) → real `kind:6050`
result (`content: "Europa"`, a correct answer to "name one moon of
Jupiter") — the full payment-gated NIP-90 loop confirmed working
end-to-end against real infrastructure, not a mock wallet, for the first
time in production. As throughout this project, **Claude only ever
published the job request and read back results — never touched
`payInvoiceWithNwc` or any payment-sending step**; the user paid both
invoices themselves.

**Still open**: the client (`client/`) still needs its own static
hosting decision executed (Cloudflare Pages/Netlify/Fly static —
decided but not implemented) with `VITE_RELAY_URL` set at its build
time to `wss://nostras.app`; `fly certs
add nostras.app` + pointing EuroDNS at Fly hasn't been done yet (still on
the free `nostras.fly.dev` hostname for now).

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
  only its note and an unmatched term returned nothing. **Client UI added
  2026-08-04** (`client/src/components/SearchView.tsx`, reachable from
  the nav rail's search icon) — see the dated entry above for the
  cache-bypass bug that surfaced (and was fixed) while wiring it up.
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
  refusing to start. `NOSTRAS_DVM_PRICE_SATS` (default 21) is now a
  **fallback only** — see the dynamic-pricing entry below — used solely if
  the real cost estimate can't be computed.
  Verified end-to-end against a disposable mock wallet (fake keys, fake
  invoice, auto-"settles" 5s after `make_invoice` to simulate a real
  payment): confirmed `payment-required` fires immediately with the
  correct amount, the summary is genuinely withheld until the mock
  reports `settled_at`, and only then does `processing` -> a real
  Claude-generated `kind:6001` result follow. The negative path (payment
  never arrives -> `error` after the 2-minute window) was not live-timed
  given the wait, but is the same simple deadline-loop code already
  exercised on the success path — verified by review, not by a live run.
  **Later verified against a real wallet too (2026-08-04)** — see the
  entry near the top of this file. Real 21-sat invoice, paid by the user
  themselves (never by Claude), correct settlement detection confirmed
  via the actual relay event timestamps, not just the UI.
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
