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
scripted/agent flow.** It was first verified against a disposable mock
wallet (fake keys, fake response, no real Lightning involved) to prove
the request/response protocol wiring is correct. **Real-wallet zap
confirmed working by the user on `app.nostras.app` (2026-08-04)**: a
real NWC wallet connected in Settings, a real ~10-sat invoice fetched
from a note author's real Lightning address, paid by the user
themselves via "Pay with connected wallet," UI correctly updated to
"Paid ✓" — the first real zap payment through this app's production
deployment. As always, Claude only ever built/showed the invoice;
the user initiated and completed the payment entirely themselves.

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

## Custom domain — `nostras.app` live and verified (2026-08-04)

`fly certs add nostras.app` + EuroDNS A/AAAA records pointed at it, cert
is issued and active — `https://nostras.app/` returns a correct NIP-11
doc and `wss://nostras.app` accepts real relay connections (verified with
`nak`), not just checked via the dashboard.

**Real gotcha hit, not just a routine wait**: this took much longer than
typical cert propagation and needed a real fix, not just patience.
Symptom: `flyctl certs list` showed `STATUS = Issued` almost immediately,
but every TLS connection attempt (curl, openssl s_client, from both IPv4
and IPv6) got reset with zero bytes back from the server — a `SSL
routines::unexpected eof while reading` / TLS decode error immediately
after the ClientHello, with `flyctl certs check` stuck on "Not verified"
the whole time. Waited it out twice (background polls, ~4 min then ~8
min) with no change. **Root cause: the app was on a *shared* IPv4**
(`public ingress (shared)`) — Fly's shared-IP edge pool apparently
doesn't sync a newly-issued custom-domain cert as reliably/quickly as a
dedicated IP does. **Fixed by `fly ips allocate-v4 --app nostras --yes`**
(a real, ongoing $2/mo cost — only done after explicitly asking the user,
since it's a recurring charge, not a one-time action) and updating the
EuroDNS A record to the new dedicated IP; the AAAA record was already
dedicated and didn't need to change. Went from "Issued but nothing
answers" to fully verified within a few minutes of switching to the
dedicated IP.

**Self-inflicted debugging mistake worth remembering**: the first two
background polls used `curl -w "%{http_code}"` and checked for "any
3-digit code" as the success condition — but curl prints `000` for
`%{http_code}` even on a total TLS failure, and `000` matched the
`^[0-9]{3}$` check used, so the *first* poll reported "success" when the
site was still completely broken. Caught by directly re-verifying with a
fresh `curl` right after the "success" notification rather than trusting
it — **the general lesson: never treat curl's `%{http_code}` as
meaningful without also checking curl's own exit code / that the
transfer actually completed**, since `000` is indistinguishable from a
real 3-digit HTTP status by pattern alone.

## Client deployed — `app.nostras.app` live (2026-08-04)

The client chose **Fly static hosting** (not Cloudflare Pages/Netlify as
the plan had tentatively suggested) — a separate Fly app,
`nostras-client`, from the relay/DVM app (`nostras`), since it's just
static files with no shared build context or runtime state.
`client/Dockerfile` is a two-stage build: `node:24-alpine` runs
`npm ci && npm run build` with `VITE_RELAY_URL` passed as a build
arg (defaults to `wss://nostras.app`, baked into the bundle at build
time since Vite inlines `import.meta.env.VITE_*` — **not** a
runtime-configurable value), then `nginx:1.27-alpine` serves the output.
`client/nginx.conf` long-caches only the content-hashed `/assets/` files
and explicitly no-caches everything else (`index.html`, `sw.js`,
`registerSW.js`, `workbox-*.js`, `manifest.webmanifest`) — otherwise a
PWA service worker update would never reach an already-installed client.
Verified locally before containerizing: `VITE_RELAY_URL=wss://nostras.app
npm run build` then `grep` the output bundle for the literal string,
confirming Vite actually inlined it, before trusting the Docker build to
do the same. **Built and deployed clean on the first attempt** (like the
server's Dockerfile before it).

**Important architectural point, easy to get backwards**: `nostras.app`
(the apex domain) is the *relay's* address (`VITE_RELAY_URL` points the
client *at* it as a backend) — it is not where the client itself lives.
The client needed its own hostname: `app.nostras.app`, a real subdomain,
not the same address.

**Same shared-IP cert propagation issue hit again, twice** — first for
`app.nostras.app` initially set up via CNAME (`app.nostras.app` →
`<hash>.nostras-client.fly.dev`, Fly's recommended pattern for
subdomains, expected to sidestep the apex's shared-IP problem since it
resolves through Fly's already-working `.fly.dev` hostname) — but the
CNAME target itself still ultimately pointed at the app's *shared*
IPv4, so the exact same `SSL routines::unexpected eof while reading` /
stuck-on-"Not verified" symptom from the relay's domain setup recurred.
**Confirmed this before waiting it out again** by resolving the CNAME
target's IP directly and testing TLS against it — same shared-IP
signature, so went straight to the known fix (`fly ips allocate-v4
--app nostras-client --yes`, another $2/mo, asked first) and swapped
the CNAME for direct A/AAAA records pointing at the new dedicated IP —
**resolved in under a minute this time**, versus the 20+ minutes the
first shared-IP incident took, confirming the dedicated-IP fix is the
right one to reach for immediately rather than waiting out a shared-IP
propagation issue a second time.

**Verified end-to-end for real, not just "the container serves files"**:
loaded `https://app.nostras.app/` in an actual browser — real "connected"
status, a real live feed of public Nostr content rendering, confirming
the deployed client is genuinely talking to `wss://nostras.app` (the
production relay) rather than falling back to localhost or failing
silently. Cross-checked independently via `curl`ing the deployed JS
bundle directly and confirming the literal string `wss://nostras.app`
is present in the built output, consistent with the browser behavior.

**All four original post-roadmap infra items are now done**: docs/
support GitHub org, `nostras.app` domain + relay, DVM payment gating
verified live, and now the client itself deployed and reachable. Nothing
required for a real person to actually use NOSTRAS end-to-end is
outstanding at the infra level anymore — remaining work from here is
product features/polish, not deployment plumbing.

## Source repo + CI/CD (2026-08-04)

The actual NOSTRAS source (this repo) lives at
**`github.com/nostras-app/nostras-source`, private** — kept deliberately
separate from `github.com/nostras-app/nostras` (the public docs/support
repo, source-free by design, see the support-site-plan memory). Before
the first push, the full git history was scanned for accidentally
committed secrets (real API keys, nsecs, NWC URIs) — clean, only
placeholder strings and prefix-matching code turned up.

**GitHub Actions now auto-deploys on push** — two path-filtered
workflows in `.github/workflows/`, monorepo-aware so each side only
redeploys when its own files change:
- `deploy-relay.yml` — triggers on `server/**`, runs `flyctl deploy` in
  `server/` using the `FLY_API_TOKEN_SERVER` secret.
- `deploy-client.yml` — triggers on `client/**`, runs `flyctl deploy` in
  `client/` using the `FLY_API_TOKEN_CLIENT` secret.

Both secrets are **app-scoped deploy tokens** (`flyctl tokens create
deploy -a <app>`, not a full-account token — least privilege, a leaked
client-deploy token can't touch the relay or vice versa), generated and
piped directly into `gh secret set` in one shell command so the raw
token values never appeared in any visible output, matching how the
DVM's own credentials are handled (though a Fly deploy token isn't
subject to the same "never even Claude" rule as the user's financial/AI
credentials — it's infrastructure access Claude already had directly
via the authenticated `flyctl` session used throughout this whole
deploy, not the user's personal financial material).

**Verified for real, not just "the YAML looks right"**: both workflow
files also match their own path filter, so pushing them immediately
triggered a real run of each — both completed with
`conclusion: success`, and a fresh `curl` against both live apps
afterward confirmed nothing broke from the CI-triggered redeploy.

## Real identity choice replaces silent anonymous signer (2026-08-04)

Prompted directly by the user noticing, on the live `app.nostras.app`
deploy, that visiting the site silently handed them an "Anonymous"
identity with **no way to see, export, or back up the key anywhere in
the UI** — confirmed by grepping the whole `components/` tree for
`nsec`/`export`/`backup` and finding nothing. For a brand built on "Own
Your Keys," a stranger's first real interaction with the product was an
unrecoverable identity they didn't know was unrecoverable — a real
pre-launch gap, not a cosmetic one, and worth fixing before actively
driving traffic to the org page.

**Scoped with the user first** (two real tradeoffs, not a default
either way): keep "Continue anonymously" as a third option rather than
removing it (people should still be able to just try the app with zero
commitment), and show the nsec directly with a copy button + strong
warning rather than adding a mandatory confirm-you-saved-it step (less
friction, matches how NIP-46/NIP-07 signers already expect users to
handle key material).

**`client/src/lib/ndk.ts` no longer assigns a signer at module load
time** — previously `signer: getDevSigner()` ran automatically the
instant the module was imported, before the user had any say. NDK
supports assigning `.signer` after construction (this is exactly how
signer *switching* already worked via `remoteSigner.ts`), so removing
the default was a small, safe change: construct `ndk` with no signer,
decide what to assign afterward.

**`client/src/components/AuthGate.tsx`** is the new first-load choice
screen — three paths:
- **Log in** — NIP-46 bunker / NIP-07 extension, reusing
  `connectBunker`/`connectExtension` from `remoteSigner.ts` unchanged.
- **Create new account** — calls the same `getDevSigner()` that
  "anonymous" already used (this was always just a locally-generated
  key; the only actual difference between "created" and "anonymous" is
  whether the resulting nsec gets shown), then displays it with a copy
  button and an explicit "gone for good if you lose this" warning.
- **Continue anonymously** — exactly the old silent behavior, now
  reached by an explicit choice instead of being the automatic default.

`client/src/lib/signer.ts` gained `hasStoredDevSigner()` — checks for
an existing local-key identity *without* generating one, so
`App.tsx`'s boot sequence can tell a genuinely first-time visitor
(show `AuthGate`) apart from a returning anonymous/created-account user
(restore silently, no gate — same as before this change for anyone who
already has a key). Resolution order on mount: try `restoreSignerSession()`
(NIP-46/NIP-07) first, then `hasStoredDevSigner()`, then fall through to
`AuthGate` only if neither matches.

**Bug caught and fixed during this change, not shipped**:
`SignerConnect.tsx` (the Settings-panel signer panel) had its own
`useEffect` that also called `restoreSignerSession()` on mount — this
predates `AuthGate` and made sense when it was the *only* place
restoration happened, but now `App.tsx`'s own boot-time resolution
already restores any saved session *before* `SignerConnect` ever
mounts (it's nested inside content gated on `authState === 'ready'`).
Left as-is, this would have meant every app load with a saved NIP-46
bunker session redundantly re-ran `blockUntilReady()` a second time.
Fixed by having `SignerConnect` just reflect the already-resolved state
(`getSavedSignerMode()` synchronously, no async restore) instead of
restoring again.

**Verified end-to-end in a real browser, all three paths**, clearing
`localStorage` between each to simulate a genuine first-time visitor:
"Continue anonymously" proceeds straight into the app as before;
"Create new account" shows a real generated nsec, the copy button's UI
state actually changes to confirm the clipboard write succeeded, and
continuing proceeds into the app; "Log in" renders the extension/bunker
UI correctly (this test browser already had a real NIP-07 extension
installed from earlier verification work, correctly detected) and the
back button returns to the choice screen. Reload-persistence confirmed
separately: after any of the three choices, a subsequent reload skips
`AuthGate` entirely and restores silently, matching the pre-existing
behavior anonymous users already had. Settings > Signer confirmed still
correctly shows the "not connected, here's how to connect a real
signer" state after choosing anonymous, verifying the `SignerConnect`
fix didn't break its normal display.

**Not independently re-verified at a narrow viewport** — `resize_window`
didn't actually apply in this session (known sandbox flakiness,
confirmed via `window.innerWidth` still reading 1920 after a resize
call reported success). Not re-fought given `AuthGate` only uses
`max-width: 380px` plus classes (`.btn`, `.input`, `.stack`) already
verified responsive elsewhere in this app — worth a real narrow-viewport
check next time the tooling cooperates, not assumed forever.

## Profile banner + follower/following counts (2026-08-04)

User request, referencing a Yakihonne screenshot as the visual target.
`profile.banner` was already available from NDK's `fetchProfile()` (a
standard `NDKUserProfile` field) — no fetch changes needed, just
rendering: `ProfileView.tsx`'s `.profile-header` became a flex column
(banner image on top, the existing avatar+info row below), with the
avatar pulled up to overlap the banner's bottom edge via a `has-banner`
modifier class applied only when a banner actually exists — profiles
without one keep the original flat layout instead of an odd empty gap
where the overlap would pull the avatar into nothing.

`client/src/hooks/useFollowCounts.ts` is new: **following** is a single
`fetchEvent({kinds:[3], authors:[pubkey]})` counting `p` tags on that
user's own contact list; **followers** subscribes `{kinds:[3],
'#p':[pubkey]}` across the full pool, deduplicated by *author* pubkey
(not event id) since kind:3 is replaceable — an author's list showing
up from two different relays shouldn't double-count. **Deliberately
scoped, not a bug**: this only reflects what's visible across relays
currently in the pool, not a true whole-network count — no single
relay indexes "everyone who follows this pubkey" without a dedicated
aggregator, same category of limitation as NIP-50 search's local-only
scope or the "seen on N relays" count elsewhere in this app. Surfaced
honestly via a `title` tooltip on the stats row rather than presented
as more precise than it actually is.

**Verified with real data, not a mock profile**: connected via a real
NIP-07 (Alby) session to the user's actual `llmops.pro` identity in a
live browser — the real banner image rendered correctly with the
avatar overlapping it as designed, and real counts appeared (467
Following, 2 Followers) in the same ballpark as the reference
Yakihonne client's numbers for the same identity (432/1) — expected to
differ, not match exactly, since each client queries a different relay
set; consistent with the honestly-scoped design, not a discrepancy to
chase down.

## NIP-05 verification + wallet balance on the profile (2026-08-04)

Same request as the banner/follow-counts work, same session — both
land on the `.profile-stats` row, right after Following/Followers, per
the user's explicit placement ask.

**NIP-05**: `NDKUser.validateNip05()` already exists in NDK and does
the real work (fetches `.well-known/nostr.json`, compares the returned
pubkey against this user's actual pubkey) — no protocol code needed,
just `client/src/hooks/useNip05Verified.ts` wrapping it reactively.
Renders as the nip05 string with a check-circle icon, colored green
when genuinely verified and dimmed gray otherwise — deliberately shows
the icon in *both* states rather than hiding it when unverified, since
the user specifically asked to see "checked or unchecked," not just
the happy path.

**Wallet balance**: `client/src/lib/nwc.ts` only had `pay_invoice`
implemented before this — refactored the request/response transport
(encrypt, publish kind 23194, wait for kind 23195, decrypt) into a
shared `sendNwcRequest()` helper, and added `getWalletBalanceMsat()`
calling NIP-47's `get_balance` through it. **Important distinction
documented inline**: the "must only run from an explicit user click"
safety rule applies to *which method* a caller sends
(`pay_invoice` moves money), not to the transport itself —
`get_balance` is read-only and safe to call automatically on profile
load, unlike `payInvoiceWithNwc`. Some wallets scope their NWC
connection string narrower than others (this project's own DVM
operator connection is a real example of a deliberately narrow scope);
`useWalletBalance.ts` treats a failed/rejected balance call as "just
don't show a balance," never a thrown error the UI has to handle.

**Verification split, and why**: the NIP-05 checkmark was verified for
real — same live NIP-07 session as the banner/counts work, genuinely
showed a green check next to `mmo@llmops.pro`, the user's real,
actually-verified identifier. The wallet balance path's *transport* is
the exact same encrypt/publish/subscribe/decrypt mechanics as
`payInvoiceWithNwc`, which had already been proven correct against
real infrastructure minutes earlier in this same session (the real
zap payment) — building a whole separate mock-wallet test harness
just to re-prove already-proven transport code for a read-only method
wasn't worth it. What *was* tested for real: the graceful-failure
path — set a syntactically valid but non-functional NWC URI, confirmed
the UI stays clean with no console errors and no broken layout once
the request times out, rather than assuming the `.catch()` would work
without checking.

## Wallet identity shown in Settings (2026-08-04)

User-reported real bug, caught while actually using the app: `Settings
> Wallet` just said "Wallet connected (NWC)" once connected — no way to
tell *which* wallet, if you'd ever connected more than one. Fixed by
parsing the saved URI (`parseNwcUri`, already existed) and showing a
truncated npub of the wallet's pubkey plus the relay host it connects
through — real, always-present identifying info from every valid NWC
URI, not something a wallet has to separately opt into exposing.
Reproduced and verified directly: set a fake NWC URI in localStorage,
confirmed the old code showed the generic string, confirmed the fix
shows `npub1qqqqqqq… via localhost:7777` (correctly matching the fake
all-zero test pubkey and relay) after the change.

**Second reported issue — resolved, not a bug.** User confirmed the
actual sequence: they'd cleared browser cache/cookies (which wipes
*all* localStorage, both the signer session and the wallet connection
together — nothing short of a server-side account system could survive
that, and this app deliberately has none), then a plain log-off/log-in
afterward correctly kept the wallet connected — matching exactly what
was already verified above. No fix needed; this was a false alarm from
attributing a cache-clear side effect to the login flow itself.

## Real gap caught: DVM was down for ~2 hours, undetected (2026-08-04)

While checking on an unrelated client machine status question, also
checked `flyctl status --app nostras` on a hunch and found the `dvm`
process group's **primary** machine (not the harmless always-stopped
standby) was `stopped` — traced via its event log to the very first
GitHub Actions CI/CD test run, roughly 2 hours earlier in wall-clock
terms. That test run's redeploy left the machine in the same
"config updated but never actually started" state documented earlier
in this file (process groups without an `[http_service]` don't
auto-start from a rolling config update) — **but this specific instance
was never caught**, because verification at the time only checked the
relay's HTTP endpoint (`curl` the NIP-11 doc), not the DVM machine's
own status. Any real NIP-90 job sent during that ~2-hour window (Ask
Claude, translate, summarize) would have gone unanswered with no
error surfaced anywhere the user would see it.

Fixed the same way as every prior instance of this exact failure mode:
`flyctl machine start <id> --app nostras`, then verified for real by
publishing an actual `kind:5050` job and confirming a genuine
`payment-required` response came back (proving the machine is
subscribed and processing, not just showing `started` in `flyctl
status`) — did not pay the resulting test invoice, same standing rule
as always.

**Process lesson, not just a one-off fix**: this is now the *third*
time this project has hit "process group without a service doesn't
auto-start after a config/image update" (first the API-key secret fix,
then this app's own initial CI/CD test, now discovered late here) —
worth internalizing as a standing check rather than something to
rediscover each time: **after *any* deploy or secrets/config change to
the `nostras` app (not just ones that touch DVM code directly), check
`flyctl status --app nostras` and confirm the `dvm` process group's
non-standby machine specifically shows `started`, not just that the
relay's HTTP endpoint responds** — the two process groups can silently
diverge in health, and only checking `web` misses exactly this class
of bug.

## Automated uptime check, directly motivated by the DVM downtime gap (2026-08-04)

`flyctl` was checked directly (`flyctl help`, `checks --help`,
`synthetics --help`) before building anything — it only exposes
`checks list` (read-only) and a `synthetics agent` (something you run
*inside* your own infra); there's no CLI command to create an alert or
notification rule. Real alerting on Fly's platform is dashboard-only,
not something scriptable/configurable on the user's behalf here.

**Deliberately not just an HTTP ping** — a generic uptime check against
`https://nostras.app/` would have shown green the entire ~2 hours the
DVM was actually down, since that's the relay's endpoint, a completely
separate Fly machine from the DVM. `.github/workflows/uptime-check.yml`
runs every 30 minutes and does three real checks: the relay's HTTP/NIP-11
endpoint, the client's HTTP endpoint, and — the one that actually matters
for this failure mode — publishes a genuine `kind:5050` NIP-90 job via
`nak` (cached as a pinned-version Go install, `v0.20.2`, to keep runs
fast) and confirms *any* `kind:7000`/`6050` response comes back within
30s. Accepts any response, not specifically a paid result — with payment
gating on, a `payment-required` event alone is sufficient proof the DVM
is alive and subscribed; the check isn't trying to verify payment flow,
just liveness. On failure, the workflow step exits non-zero, and
GitHub's own default behavior emails on a failed scheduled workflow run
— zero additional notification setup, no webhook/Slack credentials
needed, matching the option the user picked when asked.

**Verified for real, twice, not left as "the YAML looks right"**:
triggered manually via `workflow_dispatch` after pushing. First run
succeeded but exposed a real inefficiency — `nak req --stream` doesn't
exit on its own match, so wrapping it in `timeout 30` always burned
the full 30 seconds even though the DVM actually responded almost
immediately; the log showed the step taking exactly 30.0s, which
would waste Action minutes on every single scheduled run forever.
Fixed by switching to a poll loop (`nak req` without `--stream`, which
closes on EOSE, checked every 3s) that exits the moment a response
shows up. Re-tested after the fix: `DVM responded correctly (within
3s)` — confirms both that the probe logic is correct and that the DVM
is genuinely healthy right now.

## "Not Secure" despite a valid cert — outbox-discovered private-IP relays (2026-08-04)

User reported Chrome flagging `https://app.nostras.app` as "Not Secure"
despite HTTPS. **Ruled out a real TLS problem first, not assumed**:
full chain inspection via `openssl s_client` verified successfully to
the root (Let's Encrypt, valid dates, correct CN) — matching what
Chrome's own "Certificate is valid" panel told the user. No mixed
HTTP content either (checked console, network requests, and
`performance.getEntriesByType('resource')` directly — all clean).

**Root cause, confirmed from Chrome's own security panel**: a "Local
network" permission was listed — Chrome's Local Network Access
protection flags a public HTTPS page as insecure when it attempts to
reach a private/loopback address, exactly the pattern malicious sites
use to probe a visitor's home network. This matched something already
directly observed earlier in this same project: NDK's outbox-model
aggregation (`useTemporaryRelay`) adding relays discovered from OTHER
users' NIP-65 lists automatically, and one such discovered relay was
`ws://127.0.0.1:4869/` — untrusted third-party data, no real public
relay would ever legitimately be hosted at a loopback/private address
from another visitor's perspective.

**Fixed at the root, not just documented**: NDK exposes exactly the
right hook for this —
`relayConnectionFilter?: (relayUrl: string) => boolean` on the NDK
constructor, checked before any relay (including outbox-discovered
ones) is added to the pool. `client/src/lib/relayFilter.ts` blocks
localhost/loopback/private-IPv4-range/link-local/IPv6-local hostnames,
**except** the app's own explicitly configured local relay (critical:
without this exception, local dev — which legitimately runs on
`ws://localhost:7777` — would have broken entirely). Wired in via
`ndk.ts`'s `relayConnectionFilter` option.

**Verified two ways**: (1) an isolated unit test of the filter logic
against 11 cases, including the exact failing case
(`ws://127.0.0.1:4869` → blocked) and the local relay at various forms
(`ws://localhost:7777`, with/without trailing slash → allowed) — all
passed; (2) a real browser check confirming local dev still connects
correctly post-fix (feed loads, Settings still shows
`ws://localhost:7777/` as `LOCAL` + `connected`, no console errors) —
the fix could very easily have broken local dev if the "always allow
our own relay" exception had a bug, so this wasn't skipped.

**Correction: the 2026-08-04 fix above was incomplete — the real fix is
a WebSocket-level guard, not just relayConnectionFilter (2026-08-05)**:
user reported "Not Secure" recurring on `app.nostras.app`, live, across
multiple different Chrome profiles/identities on two separate computers
— clearly not a one-off, and concerning enough to treat as urgent. First
ruled out "the earlier fix never actually deployed" (it had, successfully,
on 2026-08-05 at 05:28 UTC, confirmed via `gh run list`), which meant the
fix itself had a real gap, not a deploy problem.

**Root cause, found by reading NDK 3.0.3's own installed source directly,
not assumed**: `relayConnectionFilter` only gates whether a relay gets
registered into `ndk.pool.relays` — `NDKPool.addRelay()` checks it and
correctly refuses. But `NDKPool.getRelay(url, true, true)` — the exact
call NDK's own internal outbox-relay-resolution logic uses when it
discovers relays from *other users'* NIP-65/NIP-51 lists during **any**
normal `subscribe`/`fetchEvents` call with an authors filter, not just
the narrower DM-relay-discovery path fixed on 2026-08-05 earlier the same
day — constructs and **returns** the `NDKRelay` object unconditionally,
even when `useTemporaryRelay()` → `addRelay()` refuses to register it.
The calling code still holds a live, connectable `NDKRelay` object and
uses it directly in a subscription's own relay set, completely bypassing
the filter. In other words: **the filter was real and correctly wired,
but it only closes the front door — NDK has a side door
(`getRelay(url, true, true)`) that was never covered**, and that side
door is the actual mechanism the outbox model uses by default for
ordinary browsing, which is why this kept recurring for every fresh
profile rather than being a one-time fluke.

**Fixed at the actual network boundary this time**: `client/src/lib/
wsGuard.ts` wraps the global `WebSocket` constructor itself — installed
as the *very first import* in `main.tsx`, before `lib/ndk.ts` or any
other app code runs — and throws for any private/loopback/link-local
hostname except the app's own explicitly configured relay. This closes
the gap regardless of which internal NDK code path constructs the relay,
current or future, rather than depending on correctly identifying and
patching every call site that might leak past `relayConnectionFilter`
(the same narrower approach already used once for the DM path and now
shown to not generalize). Confirmed safe by reading NDK's own
connectivity code: `new WebSocket(url)` is already wrapped in NDK's own
try/catch, which treats a thrown error exactly like a normal failed
connection (logs via its own debug channel, marks the relay
`DISCONNECTED`, the pool's `.catch()` absorbs the rejection) — so
throwing here is the library's own intended way to refuse a connection,
not a crash risk.

**Verified for real, including catching a second, unrelated issue along
the way**: local dev build confirmed the guard blocks `127.0.0.1` and
`192.168.x.x` while still allowing the local relay, with the feed
loading normally and no other console errors. First live-production
check after deploying appeared to still allow the blocked connection —
**turned out to be a stale service worker in the test tab** (it had
visited `app.nostras.app` earlier in the same debugging session, before
this fix deployed, and `injectManifest`'s precache was still serving the
old bundle) — a real instance of the exact "stale SW tab" quirk already
documented elsewhere in this file, caught by explicitly
`unregister()`-ing the service worker and clearing caches via
`navigator.serviceWorker.getRegistrations()`/`caches.keys()` before
retesting, not just assumed away. After that, the live production bundle
correctly blocked a synthetic private-address `WebSocket` construction
and still connected normally to `wss://nostras.app`.

**Known follow-up, not yet done**: Chrome's Local Network Access
permission state is per-origin and sticky — once an origin has been
flagged, the "Not Secure" label and the stored permission entry can
persist in a given browser profile even after the underlying cause is
fixed, until the user manually hits "Reset permissions" (visible in
their own screenshot) for `app.nostras.app` once. The code fix stops
this from happening to **new** visitors and fresh profiles going
forward; it does not retroactively clear the flag already stored in the
profiles that hit the original bug. Worth the user confirming a reset
actually clears it on one already-affected profile, to close the loop.

**Loop closed, 5 days later (2026-08-10)**: user reported the "Not
Secure" flag had genuinely persisted the entire time on both a desktop
and a laptop Chrome install, but confirmed it never showed in Firefox —
exactly the pattern this sticky-permission theory predicts (Firefox
doesn't implement Chrome's Local Network Access warning the same way,
so it was never going to show there regardless of the underlying cause;
a stored per-profile Chrome flag from the original bug window would
independently persist on every Chrome install that visited during that
window, explaining "always, on both machines, Chrome-only"). Verified
this wasn't a live regression before pointing at stale permissions as
the explanation, not just assumed: constructed a real
`new WebSocket('ws://127.0.0.1:9999/')` directly in a live production
tab and confirmed `wsGuard.ts` still throws a `SecurityError` and
blocks it correctly, checked the live console for zero `[wsGuard]
Blocked` warnings during 8s of normal app use (nothing being blocked
right now, consistent with no live private-relay discovery happening in
that session), and checked network requests for any plain-`http://`
mixed content (Chrome's other common "Not Secure" trigger) — none
found. The fix is confirmed still correctly active in production; the
remaining flag is Chrome's own stored per-origin state from before it
shipped. Resolution is a one-time manual step per already-affected
Chrome profile, not a code change: click the icon left of the address
bar → Site settings (or permissions) for `app.nostras.app` → Reset
permissions, then reload.

**Correction, same day: the sticky-permission theory was wrong.** The
user actually did the reset-and-reload test — real evidence, not
hypothetical. Chrome's own permission bubble showed exactly one
resettable entry ("Pop-ups and redirects," left at its default), no
separate Local Network Access permission to reset at all; clicking
"Reset permission" and reloading did not clear the flag. If the
original private-relay bug were still the live cause, Chrome would
show a dedicated Local Network Access toggle here — its absence is
real evidence against that theory, not just an inconclusive test.

Chased three more concrete hypotheses live, each directly tested
rather than assumed, each ruled out: (1) mixed HTTP content — grepped
the live DOM for any `http://` `src`/`href` on img/video/audio/
script/link elements, zero found, and captured 17 real network
requests during 8s of normal use, all HTTPS, all legitimate hosts
(nostr.build, primal.net CDNs, satellite.earth, the app's own origin).
(2) Insecure `ws://` connections to *public* (non-private) hosts — a
real gap `wsGuard.ts` doesn't cover, since it only checks for
private/local hostnames, not scheme; but tested directly and Chrome's
own browser-level mixed-content policy blocks any `ws://` construction
from an `https://` page synchronously, before the page's own code (or
`wsGuard`) ever runs — so this can't be the cause either, structurally
impossible. (3) A CA-distrust issue some Chrome versions have for
Entrust/AffirmTrust-issued certs — checked the real chain via
`openssl s_client`: Let's Encrypt end-to-end (`YE1` → `ISRG Root
X2`), not an affected CA. (4) A broken HTTP→HTTPS redirect — checked
directly with `curl`, correctly 301s to `https://app.nostras.app/`.

**Genuinely unresolved as of this entry** — every mechanism this
project's own history would predict has now been checked and ruled
out. Hit a real limitation of the available tooling: browser
automation here only observes page content, not Chrome's own address
bar/security UI, so what the user's Chrome is actually flagging
can't be independently observed from this side, only inferred by
testing hypotheses one at a time. Asked the user to open DevTools'
Security tab directly (Chrome's own authoritative, specific reason for
the flag, not the generic summary bubble) as the next concrete step,
rather than continue guessing. Not yet answered as of this entry.

**Header connection-status pill removed (2026-08-05)**: user-requested —
the pill was redundant with Settings > Relays (which already shows live
per-relay status), and on narrow/mobile viewports it visually overlapped
the NOSTRAS wordmark. `App.tsx`'s `header-right` div is now an empty
grid spacer (mirrors `header-spacer` on the left, keeping the brand
centered via the existing 3-column grid) instead of rendering
`useRelayStatus`-driven state. `App.css`'s `.status-pill`/`.status-dot`
rules were removed as dead code, but `@keyframes pulse` was kept since
`.status-dot-standalone` (the per-relay dots inside `RelaySettings.tsx`)
still animates with it. Build and lint both passed clean. **Not
browser-verified this pass** — this session had no live Chrome
extension connection available, so the fix rests on code review + a
successful build/lint + a grep confirming no other component reads
`useRelayStatus`/the removed classNames, not an actual rendered check;
worth a quick visual confirmation (especially the mobile-overlap
scenario that motivated the change) next time the app is checked in a
browser.

**Direct messages landed — NIP-17 only, the nav rail's last remaining
piece (2026-08-05)**: scoped via an explicit choice between NIP-04
(legacy, weaker — leaks sender/recipient pubkeys and timing to any relay
operator) and NIP-17 (modern — kind 14 rumor sealed then gift-wrapped as
kind 1059, encrypted with NIP-44, wrapped under a throwaway ephemeral
key so relays only see two random-looking pubkeys, not who's really
talking to whom); user picked NIP-17 only, since NOSTRAS has no legacy
users to migrate and there's no reason to also ship the weaker standard.
**No protocol code was hand-rolled** — `@nostr-dev-kit/ndk` (v3.0.3)
ships real `giftWrap()`/`giftUnwrap()` helpers plus NIP-44
`encryptionEnabled()` support across all three signer types this app
already has (dev key, NIP-46, NIP-07), so this was a case of wiring
existing library primitives together, not implementing NIP-59/NIP-44
from scratch. `client/src/lib/dm.ts`: `sendDirectMessage()` builds an
unsigned kind:14 rumor and gift-wraps it **twice** — once for the
recipient, once for the sender — since NIP-17 requires a sender's-own
copy so a conversation still shows your own sent messages on reload
(without it, only the recipient's copy would ever decrypt for you);
`decryptGiftWrap()` wraps `giftUnwrap()` and fails closed (returns
`null`, doesn't throw) for anything that doesn't decrypt/parse as a
valid rumor, since it runs per-event inside a live subscription. Both
publish/read through the same `devPublishRelaySet`/local-only
conventions as every other feature — a DM only actually reaches its
recipient once the recipient's relay is opted in via Settings > Relays,
same dev-safety tradeoff already accepted project-wide.
`client/src/hooks/useDirectMessages.ts` subscribes to kind:1059 events
tagging the active user (same long-lived-subscription pattern as
`useNotifications`), decrypts each on arrival, and groups the result
into per-peer conversations. `client/src/components/MessagesView.tsx`
is a conversation list + thread view + a "start new conversation by
npub" input, wired to the nav rail's previously-disabled Messages icon
(`NavRail.tsx`, `'messages'` added to the `View` union in both
`NavRail.tsx` and `App.tsx`).
**Real bug caught before it shipped, not hypothetical**: the first draft
called `useDirectMessages()` — which opens a live relay subscription —
separately in `MessagesView`, `ConversationList`, `ConversationRow`,
*and* `Thread`, meaning every rendered conversation row would have
opened its own duplicate subscription to the same filter. Fixed by
calling the hook exactly once at the top of `MessagesView` and passing
`conversations`/`loading` down as props — caught by re-reading the
component tree before testing, not by observing the duplicate
subscriptions live.
**Verified for real, not just built clean**: `tsc -b && vite build` and
`oxlint` both passed with no new errors/warnings. The actual NIP-17
crypto path was verified end-to-end with a standalone script
(two throwaway `NDKPrivateKeySigner` identities, real connect to the
local relay) that calls the exact same `giftWrap`/`giftUnwrap` functions
`dm.ts` uses: confirmed the wrap is genuinely kind 1059 with a random
outer pubkey (not the real sender's), confirmed the recipient's signer
correctly decrypts the rumor to the original plaintext with the real
sender's pubkey recovered only through decryption, and confirmed the
sender's own self-addressed copy decrypts correctly too. **UI-layer
verification (clicking through the nav rail, sending a message from the
actual composer, seeing it render in a thread) was not done this
session** — no live Chrome extension connection was available — so the
React wiring rests on code review + the clean typecheck/build/lint, not
an actual rendered check; this is the same gap flagged for the
status-pill removal above, and both are worth a live pass together next
time the app is checked in a browser.

**DM round trip confirmed working for real between two real accounts on
production (2026-08-05)**: the user sent a live test message from their
own identity ("MMO") to a second real identity ("SOVEREIGN_CITIZENS") on
`app.nostras.app`. First report was that the recipient didn't see it —
investigated directly against the relay (`nak req -k 1059
wss://nostras.app`) and found the gift-wrap events were genuinely
there: NIP-59 deliberately randomizes the *outer* wrap's `created_at`
(to prevent timing-correlation attacks), so a naive "anything from the
last 30 minutes" relay query looked empty even though the send had
already landed — a real, worth-remembering gotcha for any future
debugging here: **never filter/reason about kind:1059 events by their
own `created_at`, only the decrypted rumor's `created_at` is real send
time.** The actual fix was simpler than any protocol issue — the
recipient just needed to reload to pick up the freshly deployed build.
Confirmed conclusively once the recipient replied from their own
account and the reply appeared correctly threaded, correctly aligned
(their message on the left, the original sender's on the right), with
accurate relative timestamps on both sides — the first real
bidirectional NIP-17 conversation between two genuine identities on
this deployment.

**Automatic recipient-relay discovery for DMs (2026-08-05)**, prompted
directly by the round-trip test above surfacing a real limitation: SC's
reply reached MMO only because both clients happened to already share a
public relay (Yakihonne apparently publishes there) — MMO's message
to SC never reached SC at all, because `devPublishRelaySet` is
local-only by default and Yakihonne was never reading from
`wss://nostras.app`. User chose to fix this properly (automatic
relay-list lookup) over leaving it as a manual per-conversation
workaround. `client/src/lib/dm.ts` gained
`discoverRecipientDmRelays(pubkey)`: looks up the recipient's kind:10050
"DM relay list" (NIP-17's purpose-specific relay list, preferred over
their general relays specifically so gift wraps don't blend into a
user's regular read/write traffic) and falls back to their NIP-65
kind:10002 write relays if they haven't published one — same
fetch-and-parse shape as `useNip65RelayList.ts`. `sendDirectMessage` now
publishes the recipient-addressed wrap to the union of
`devPublishRelaySet` and whatever was discovered, so a DM reaches the
recipient's actual client (any NIP-17-capable one, not just other
NOSTRAS users on the same relay) while still respecting the local-only
default for the sender's own self-copy.

**Real security issue caught and fixed before this shipped, not
hypothetical**: a recipient's relay list is untrusted third-party data —
the exact same category that caused the earlier "Not Secure" bug
(outbox-discovered relays containing a private/loopback address). Traced
through NDK's actual source (`NDKRelaySet.fromRelayUrls()` →
`pool.useTemporaryRelay()` → `pool.addRelay()`) and found the existing
`relayConnectionFilter` protection does **not** actually cover this path:
`fromRelayUrls()` adds the `NDKRelay` object to the relay set it returns
unconditionally, even when the pool's own `addRelay()` internally
refuses to register a blocked URL — and `NDKRelaySet.publish()` iterates
that local relay set directly, never rechecking the pool. So a malicious
recipient relay list could have made this app attempt to connect out to
(and publish toward) a private/local address, bypassing the filter that
was specifically built to prevent exactly that. Fixed by reusing
`relayFilter.ts`'s `makeRelayConnectionFilter` directly at the call site
in `dm.ts`, filtering discovered relay URLs *before* they ever reach
`NDKRelaySet.fromRelayUrls()`, rather than trusting pool-level
protection for this path.
**Verified for real**: a throwaway identity published a real kind:10050
list to the local relay containing one legitimate relay URL and one
private-IP URL (`ws://127.0.0.1:9999`); fetching and filtering it
confirmed the private one was dropped and the legitimate one passed
through. The kind:10050 discovery path was verified the same way. The
kind:10002 fallback path (structurally identical code, same
`ndk.fetchEvent` shape already proven correct in production by
`useNip65RelayList.ts`) hit repeated connection flakiness in this
session's standalone test scripts after many rapid successive local-relay
connections in a short window — including the *publish* itself timing
out on one attempt, confirmed via direct `nak` queries to be a
test-harness/connection-churn issue and not a relay-side data problem —
so it rests on code review and structural identity with already-proven
code rather than a fresh isolated live test; worth a real check next
time this path is exercised organically (a live DM to a recipient who
only has a NIP-65 list, no kind:10050) rather than assumed indefinitely.

**Recipient-relay discovery confirmed working live, closing the gap
flagged above (2026-08-05)**: the user logged into MMO's real account
via NIP-46 using `nak bunker` (see the entry below on that), and sent
a fresh message from MMO to SC — this time SC (still on Yakihonne, a
separate client) received it automatically, with no manual relay
toggling in Settings required. This is the real, organic confirmation
that was missing before: automatic recipient-relay lookup
(kind:10050/kind:10002) genuinely fixes cross-client DM delivery in
production, not just in isolated tests.

**NIP-46 login via `nak bunker` walked through and verified live
(2026-08-05)**: user asked how to log in via NIP-46 without a browser
extension available (testing from a Chrome Guest profile, no Alby).
`nak bunker --sec <key> <relay>` starts a NIP-46 signer daemon and
immediately prints a ready-to-use `bunker://<pubkey>?relay=...&secret=...`
URI — confirmed for real with a throwaway key against `wss://nostras.app`
before explaining it, rather than guessing the command/output shape.
User then used it for real with MMO's own key and successfully logged
in by pasting the URI into Settings > Signer, confirming NIP-46 bunker
login works end-to-end in production via a completely different signer
implementation than the NIP-07 (Alby) and dev-key paths already
verified — and that DMs correctly follow whichever identity is actually
signed in (no stale cached state from a prior session), decrypting
fresh via the bunker connection. Separately, a "can't paste into the
bunker field" report turned out to be the user's own Linux-vs-Windows
clipboard muscle memory, not an app bug — confirmed via a source grep
that NOSTRAS has no `onPaste`/`preventDefault` handling anywhere, all
clipboard code is write-only (copy buttons).

**DVM caught down by the uptime-check workflow, a new variant of the
recurring "process group never auto-starts" bug (2026-08-05)**: user got
a GitHub failure-notification email; turned out to be the `Uptime check`
scheduled workflow (not a deploy) catching the DVM's primary machine in
`stopped` state (`flyctl status --app nostras`). Event log showed
`exit_code=0, requested_stop=false` at `07:08:26 UTC` — a clean,
self-initiated exit, **not following any deploy** (confirmed via
`gh run list --workflow=deploy-relay.yml`, last relay deploy was the
day before). Every prior instance of this exact "process group with no
`[http_service]` doesn't auto-restart" bug was triggered by a deploy or
secrets change; this is the first known case of it happening with zero
triggering event, which matters for how much this can be trusted to
"only happen right after I touch the relay app" going forward — it
apparently can also just happen on its own. Fixed the same way as every
prior instance: `flyctl machine start`, then verified for real with a
fresh `kind:5050` job that got a genuine `payment-required` response
(not just trusting the status table), and re-ran the uptime-check
workflow manually to confirm green. This is exactly the failure mode
the uptime-check workflow was built to catch, and it worked correctly —
three failed scheduled runs today were all this one incident, not three
separate problems.

**Follow/unfollow + a personalized "Following" feed (2026-08-05)**: the
last conspicuous gap flagged in a roadmap-status review — `ProfileView`
showed follower/following *counts* (`useFollowCounts.ts`) but had no
actual follow action, and the home feed was always global (everyone),
never "people I follow." Scoped via two explicit choices: the feed-type
switch is tabs on the Home view itself, not buried in Settings (matches
Twitter/Bluesky convention, more discoverable); the Follow button lives
on the profile view only for this first pass, not also inline in the
feed.

**Real prerequisite discovered while scoping, not scope creep**:
`ProfileView` only ever showed the *active user's own* profile — there
was no way to view anyone else's at all, which meant "Follow button on
profile view" was impossible without first adding real navigation to
other users' profiles. `client/src/lib/navigation.ts` is a new
module-level `useSyncExternalStore` store (same pattern as
`useProfile`/`relayStatus.ts`) holding `{view, profilePubkey}` —
`setActiveView(view)` (used by the nav rail) always resets
`profilePubkey` to `null` (meaning "my own"), while the new
`viewProfile(pubkey)` sets both atomically. This replaced `App.tsx`'s
local `activeView` useState entirely, specifically so `viewProfile()`
can be called from deep inside `FeedItem` (nested under Feed/SearchView/
BookmarksView/ProfileView's own notes list) without prop-drilling a
callback through all of them. `ProfileView` now takes an optional
`pubkey` prop (omitted = own profile, matching prior behavior); clicking
an author's avatar or name anywhere in the app opens their profile
read-only, with a Follow/Unfollow button shown only when it isn't your
own.

`client/src/hooks/useFollowing.ts` is the kind:3 contact-list
fetch-then-republish hook, same shape as `useBookmark`/the mute list —
`toggle(pubkey)` only ever adds/removes the one `p` tag it's touching,
preserving every other tag and the event's `content` field untouched
(some older clients still store legacy relay-list JSON there). Serves
both the Follow button (`isFollowing`/`toggle` against a specific
pubkey) and the Following feed (`pubkeys`, the full list) from one
fetch. `client/src/components/Feed.tsx` gained the Following/Global tabs
(persisted to `localStorage`, not a Nostr event — this is a pure UI
preference, not data other clients need to see) and reuses
`useNoteFeed`'s existing optional `authors` parameter — no feed-fetching
changes needed, that hook already supported this shape for
`ProfileView`'s own-notes list. A "Following" feed with zero follows
gets a distinct empty state pointing at how to follow someone, rather
than the generic "no notes yet."

**Verified for real, not just built clean**: `tsc -b && vite build` and
`oxlint` both passed. The core `toggle()` tag logic was verified
end-to-end against the local relay with a throwaway identity: seeded a
kind:3 with one existing follow, a legacy relay-list JSON `content`
field, and an unrelated tag; followed a second pubkey, then unfollowed
the first; fetched the final event directly via `nak` and confirmed
exactly the right pubkey was removed, the new one was added, the
unrelated tag survived, and the legacy content field was untouched byte
-for-byte. (NDK's own `fetchEvent()` for replaceable-kind events was
flaky in this session's standalone test scripts after a long run of
rapid successive local-relay connections — same pattern hit earlier
testing the DM relay-discovery fallback path — so the multi-step part of
this test chained local state between publishes rather than re-fetching,
with `nak` as the independent, always-reliable verification of the
relay's actual final stored state.) **UI-layer verification (clicking an
author in the feed, following/unfollowing from a live profile page,
switching feed tabs) was not done this session** — no live Chrome
extension connection was available — consistent with the same gap
already flagged for the header-pill removal and the DM feature; worth a
real browser pass together next time the app is checked live.

**Web Push notifications — the last item from the original roadmap
review (2026-08-05)**: scoped via one explicit security decision before
building — registering a push subscription requires a NIP-98-signed
proof of pubkey ownership, not a bare claimed pubkey, since an
unauthenticated registration would let anyone start receiving another
user's notification metadata (who mentioned/DMed/zapped them — the DM
*content* stays safe either way since it's separately encrypted, but
"you got a DM from X" is itself metadata worth protecting).

**Server** (`server/nip98.go`, `push.go`, `push_handlers.go`,
`push_notify.go`): go-nostr v0.52.3 (this project's pinned version) has
no `nip98` package, so NIP-98 verification is hand-rolled — decode the
`Authorization: Nostr <base64 kind:27235 event>` header, check the
signature via go-nostr's own `Event.CheckSignature()`, check the
timestamp is within 60s (replay protection), check a `method` tag
matches the request and a `u` tag's path matches (deliberately just the
*path*, not scheme+host — this runs behind Fly's proxy, where the Host
header the server sees can differ from what the client actually signed
against; exact URL matching is NIP-98's stricter recommended mode, not
required for what's fundamentally a device-registration endpoint with
no destructive action). Subscriptions are stored in a plain
mutex-guarded JSON file (`push-subscriptions.json`, gitignored, keyed by
pubkey) — deliberately NOT a Nostr event like everything else this
relay persists, since a subscription's endpoint/keys are real
device-identifying data that must stay private, never broadcast.
`relay.StoreEvent` (the same khatru hook point `search.go`'s indexing
uses) gained a new hook: on any notification-worthy kind (1/6/7/9735/
1059, matching `NotificationsView`'s in-app list plus DMs), look up each
tagged `p`'s subscriptions and fire a `webpush-go` `SendNotification`
call per device, in a goroutine so a slow/unreachable push service never
adds latency to normal event storage. Push payloads are deliberately
generic (`{title, body}`, no actual note/DM content) — for kind:1059 the
server can't decrypt it anyway, and keeping public-note payloads generic
too is a reasonable default for what travels through a third-party push
service. A 410/404 response from the push service (subscription
permanently gone) triggers automatic cleanup from the store.

**Client**: switched `vite-plugin-pwa` from the default `generateSW`
strategy to `injectManifest` (`client/src/sw.ts`) — `generateSW`
auto-writes a service worker with no room for custom code, and this
project's SW previously had zero custom logic. Hit a real TypeScript
gotcha doing this: `tsconfig.app.json` compiles all of `src/` under the
`DOM` lib, but service worker globals (`self`, `ServiceWorkerGlobalScope`,
push/notificationclick event types) come from the `WebWorker` lib, and
the two conflict if mixed in one compilation — fixed by excluding
`src/sw.ts` from `tsconfig.app.json` and giving it its own
`tsconfig.sw.json` (WebWorker lib only), added as a third project
reference alongside the existing app/node configs. `client/src/lib/
pushNotifications.ts` handles permission request, `PushManager.subscribe()`
with the VAPID public key, and building the NIP-98 auth header via the
active signer (`NDKEvent.sign()` — works identically for whichever
signer is connected, dev key/NIP-46/NIP-07, same as every other signed
action in this app) before POSTing to the relay's `/push/subscribe`.
VAPID public key is baked in at build time the same way `VITE_RELAY_URL`
is (`client/Dockerfile`'s `ARG VITE_VAPID_PUBLIC_KEY`, defaulted to the
real production key so a plain `docker build` still works) — it isn't
actually secret, only the private key (a Fly secret on the relay app,
`NOSTRAS_VAPID_PRIVATE_KEY`) needs to stay protected.
`PushNotificationSettings.tsx` is a new Settings section (Enable/Disable,
matching `SignerConnect`/`NwcConnect`'s layout conventions).

**Verified for real, in three layers**: (1) the full server pipeline —
NIP-98 subscribe (valid auth accepted, no-auth and wrong-method-tag both
correctly rejected with 401), subscription storage, and the
`StoreEvent` push-trigger hook — verified against the local relay with
`nak`-constructed auth events, including publishing a real kind:1 note
tagging a subscribed pubkey and confirming a genuine `webpush.
SendNotification()` call was attempted (it failed only because the test
P256dh key was garbage, not a real browser-generated EC key — that
failure is itself proof the whole chain up to the actual network call
worked); (2) unsubscribe correctly removes the stored subscription; (3)
the exact `NDKEvent.sign()`-built auth header `pushNotifications.ts`
constructs (not just `nak`'s) was independently confirmed accepted by
the server, closing the gap between "the server verifies NIP-98
correctly" and "the client's actual auth-building code produces
something the server accepts." **Real deploy incident hit while wiring
this up, not hypothetical**: `flyctl secrets set` for the VAPID keys
timed out mid-rolling-restart, and the DVM machine came back `stopped` —
the same recurring "process group with no `[http_service]` doesn't
reliably survive a machine restart" pattern already documented multiple
times in this file, now confirmed to also trigger from a secrets-only
restart, not just a full deploy. Fixed the same way as every prior
instance (`flyctl machine start`), and confirmed via `flyctl status`
before moving on, per the standing lesson. **The actual new `/push/*`
routes weren't live until the real code deploy went out** (setting
secrets alone only restarts the *existing* image with new env vars) — a
first `curl` against `https://nostras.app/push/subscribe` correctly
404'd before the deploy, confirming the sequencing rather than assuming
it. **UI-layer verification (clicking Enable in Settings, actually
receiving a push notification while the app is closed) was not done
this session** — no live Chrome extension connection was available, and
a full click-to-permission-to-real-device-registration flow needs an
actual browser anyway; same gap as the other features built this
session, worth a real pass (ideally on a phone, to see push arrive with
NOSTRAS fully closed) next time the app is checked live.

**Known false-negative deploy failure: DVM boot-vs-DNS race during
simultaneous web+dvm rollout (2026-08-05, deliberately left unfixed for
now)** — the push-notification deploy above (`deploy-relay.yml`) reported
`failure` and the user got a GitHub failure email, but the app was never
actually broken. `flyctl deploy` rolls `web` and `dvm` out at the same
time; the DVM connects to the relay at boot via Fly's internal DNS
(`ws://web.process.nostras.internal:7777`), and it can start a hair
before `web`'s new instance finishes registering in Fly's internal DNS —
first boot attempt(s) panic with `no such host`, but Fly's normal
crash-restart loop retries and it comes up clean within ~20s once `web`
is reachable (confirmed in the actual boot log: three panics, then
`NOSTRAS DVM ... running`, `payment gating: ON`). **The deploy tool's own
smoke check gives up right after the first crash**, before the
retry-and-recover cycle finishes, so it reports the deploy as failed even
though the end state (verified independently via `flyctl status` and a
live request against the new endpoints) is healthy. This can recur on
*any* future deploy that touches `server/`, not just this one — the real
fix would be having the DVM retry its own startup connection with
backoff instead of panicking on the first failure, so it doesn't depend
on the outer crash-restart mechanism to recover. **Explicitly deferred
by the user — not a priority, logged here to fix sometime in the
future**, not forgotten.

**Push notifications confirmed working live, end to end, on a real
device (2026-08-05)**: clicked Enable in Settings > Notifications on
the real `MMO` account (`nip07` signer mode, confirmed via
`localStorage`) — permission granted, `PushManager.subscribe()`
succeeded against a genuine Google FCM endpoint, NIP-98 auth accepted by
the server (204). Then, from this same session, looked up MMO's real
pubkey via their actual NIP-05 (`mmo@llmops.pro` →
`0da1a169a4e684d0b0ac1a370871575e4b8f3c56c8a7411b9ff7f27aea6c90e7`) and
published a real throwaway-signed kind:1 note mentioning that pubkey
directly to `wss://nostras.app` via `nak` — **the user confirmed
receiving a real OS-level notification seconds later.** First time this
feature has been proven end-to-end on real infrastructure with a real
device, not just the server-side pipeline tests from earlier today.
**Real bug caught along the way, not shipped**: a browser tab that had
been open since before this exact deploy went out got stuck showing
nothing but the header (`ndk.connect()`/auth resolution never
completed) after the new service worker (`clientsClaim()`) took control
mid-session — reproducible once, did not recur in a fresh tab, and the
"missing" Notifications section from that same stuck tab was a symptom
of this, not a separate bug (confirmed by loading a brand-new tab, which
rendered the full app and the Notifications section correctly on the
very first try). Worth knowing about: a tab left open across a service-
worker-changing deploy can end up in a bad state and may need a manual
close-and-reopen, not just a reload, to recover.

**Install-PWA button — the last item from the original roadmap review
(2026-08-05)**: per the strategy doc's own plan, an explicit "Install
NOSTRAS" button rather than relying on the browser's own subtle
install affordance. `client/src/lib/pwaInstall.ts` captures
`beforeinstallprompt` at **module scope**, not inside a component —
Chrome can fire it before React ever mounts, and missing it would mean
no install button for the rest of that session; `preventDefault()` is
called so the app's own button is the only prompt shown, not both.
Exposed reactively via the same `useSyncExternalStore` pattern as
`useActiveUser`/`relayStatus.ts`. Detects already-installed via
`display-mode: standalone` (desktop/Android) or the legacy
`navigator.standalone` (iOS). **iOS Safari never fires
`beforeinstallprompt` at all** — no install API exists there per Apple's
own platform limits — so `InstallPwaSettings.tsx` detects iOS via user
agent and shows "tap Share → Add to Home Screen" instructional text
instead of a button, matching the strategy doc's documented gap rather
than silently showing nothing. New Settings > Install App section.
Verified: `tsc -b && vite build` and `oxlint` clean. **Not live-tested in
a real installable context this pass** — `beforeinstallprompt` requires
real installability heuristics (visit engagement, valid manifest, HTTPS)
that don't necessarily fire on demand in a quick automated browser
check, so this rests on the API contract (correct per MDN/the spec) and
a clean build rather than an observed real install; worth confirming
live next time, ideally on Android Chrome or desktop Chrome/Edge where
the prompt is most reliably offered.

**Real installed-app icon quality bug, caught and fixed (2026-08-05)**:
user installed the PWA (confirming the install button above genuinely
works end-to-end) and reported the home-screen icon looked ugly —
screenshot showed a flat black bolt with visible magenta/pink fringing
at the edges, nothing like the actual purple→blue gradient brand mark.
Root cause: `public/pwa-192x192.png`/`pwa-512x512.png` were pre-existing
placeholder files (not even square — 192×184 and 512×491) that had
never actually matched `favicon.svg`, the real brand asset used
everywhere else in the app. **Confirmed the low-quality issue was in the
conversion tooling, not the source SVG**: ImageMagick's fallback SVG
delegate (`rsvg-convert` isn't installed in this sandbox and couldn't be
via `apt` without a sudo password) produces exactly this kind of broken
output — flattened the gradient to solid black and mangled the
blur-filtered glow layers into stray white/magenta fringing when tested
directly, i.e. reproduced the exact bug being fixed. Used Python's
`gi.repository.Rsvg` + `pycairo` bindings instead (the real librsvg
engine, already present as a system library even without the
`rsvg-convert` CLI wrapper) to render clean PNGs directly from
`favicon.svg` at 192×192 and 512×512, transparent background, ~8%
padding. Also added a **dedicated** maskable icon
(`pwa-maskable-512x512.png`, 15% padding safe zone, opaque black
background matching the manifest's `background_color`/`theme_color`)
instead of the previous config reusing the plain 512×512 file for both
`any` and `maskable` purposes — a maskable icon needs its own safe-zone
padding and an opaque background, since OS mask shapes (circle,
squircle, etc.) crop the *entire* square including any transparency.
Verified: manifest.webmanifest correctly references all three files
with proper sizes/purpose, `tsc -b && vite build` and `oxlint` clean.
**Confirmed fixed on real devices, both Android and iOS**: user
reinstalled the PWA on Android and separately checked iOS — both show
the correct gradient bolt, matching the brand. The original bug (flat
black with color fringing) is gone on both platforms.

**Rich media (images/GIFs/video/audio) and NIP-23 articles landed
(2026-08-05)**: previously the composer only published plain text, and
long-form articles were explicitly out of scope. Scoped via two
explicit choices: media uploads go to an existing public Blossom
server rather than self-hosting one (no new storage/bandwidth
infrastructure, matching the project's general non-custodial/bring-
your-own philosophy), and articles get a real compose *and* reading
view in NOSTRAS, not just publish-and-hope-another-client-renders-it.

**Media upload** (`client/src/lib/blossom.ts`): uploads to
`blossom.primal.net`, confirmed via a real test upload (`nak blossom
upload`) to accept open uploads with zero allowlisting before writing
any client code. Blossom's own auth event (kind 24242 per BUD-11,
distinct from NIP-98's 27235 already used for push-subscription
endpoints) is signed via the active signer, scoped to the specific
file's SHA-256 (computed client-side via `crypto.subtle.digest`) with a
5-minute expiry. **Real spec-vs-implementation mismatch caught before
shipping**: BUD-11 specifies base64url-*without*-padding for the
`Authorization` header, but a real test against this app's actual
server (blossom.primal.net) rejected that with `"invalid base64 for
auth event"` and only accepted standard base64 (with padding, same
encoding NIP-98 uses) — shipped code matches what the real server
actually accepts, documented inline so a future reader doesn't
"correct" it back to the spec text and break it again.
`Composer.tsx` gained a file-attach button (multi-select,
`image/*,video/*,audio/*`), each file uploads independently with its
own chip showing progress/done/error state, and successfully-uploaded
URLs get appended to the note's content on publish (plain URLs in
content, not NIP-92 `imeta` tags — matches the read-side rendering
choice already made in `parseContent.ts`, "simple and broad-
compatibility over precise," kept consistent rather than introducing a
new asymmetric convention).

**Articles** (kind 30023): `client/src/lib/article.ts` parses the
standard NIP-23 tags (`title`/`summary`/`image`/`published_at`) shared
by the card and detail views. `useNoteFeed.ts` now fetches `[1,
30023]` instead of just `[1]`, and `Feed.tsx`'s `FeedItem` branches on
`event.kind` to render `ArticleCard.tsx` instead of a normal note —
done at that one shared call site rather than per feed, so search
results/bookmarks/a profile's own notes all pick up article cards
automatically too. Clicking a card calls the new `viewArticle(event)`
(`lib/navigation.ts`, same shared-state pattern as `viewProfile()`,
extended to also hold the clicked `NDKEvent` directly rather than
re-fetching by `naddr` since the event's already in hand) to open
`ArticleView.tsx`. **Markdown is rendered via `react-markdown`, not
`marked`+`dangerouslySetInnerHTML`** — a deliberate security choice:
article content comes from arbitrary Nostr authors (untrusted input),
and `react-markdown` renders directly to React elements rather than
raw HTML strings, so there's no injection surface to sanitize in the
first place, unlike an `innerHTML`-based approach. `Compose` (nav rail)
now shows a Note/Article tab (`ComposeView.tsx`) — `ArticleComposer.tsx`
publishes with a fresh `crypto.randomUUID()` `d` tag (editing/
republishing the same article under a stable `d` is a real NIP-23
capability but out of scope this pass) and can also attach a cover
image via the same Blossom upload path as regular note attachments.

**Verified**: `tsc -b && vite build` and `oxlint` clean. The Blossom
upload path was verified with the *exact* shipped encoding logic (not
just the spec) via a standalone script using real `NDKEvent` signing
against the real server — confirmed a real file upload, hash match, and
retrieval (following the server's redirect to its CDN). The NIP-23
publish shape was verified by publishing a real article to the local
relay via `nak` with the exact tag names `article.ts` expects
(`d`/`title`/`summary`/`published_at`) and confirming it's queryable by
`kind:30023`, matching what `useNoteFeed`'s updated filter now requests.
**UI-layer verification, done live, found a real (pre-existing, not
introduced by this feature) production reliability bug**: attaching a
real PNG via the actual file input (Chrome's `file_upload` MCP tool) and
publishing from the live composer worked — the chip showed
"✓ test-image.png" and Publish enabled correctly. But the publish
attempt itself repeatedly reported `NDKPublishError: Not enough relays
received the event` in the console while the composer never cleared. A
direct `nak` publish attempt against the same relay *also* timed out at
the same time, and the relay's own logs showed a flood of `"ERROR: too
many concurrent REQs"` responses from `wss://nos.lol` and
`wss://relay.damus.io` — the pre-existing NIP-65 outbox-aggregation
system (`server/outbox.go`) fanning out under real concurrent
production traffic. **The publishes had actually succeeded server-side
despite the client reporting failure** — confirmed via a direct relay
query — so retrying (reasonably, given the UI showed no success)
created 3 duplicate real posts on the user's actual account, plus one
unexplained 4th post with a `.mp4` attached that was never intentionally
selected (likely stale composer state from the repeated retries, root
cause not yet isolated). **Correction to the paragraph above, found
minutes later**: this was *not* a pre-existing, unrelated NDK
reliability gap — it was a real regression in this session's own new
push-notification code. `store.subscriptionsFor()` (`server/push.go`)
took `pushStore`'s mutex *synchronously* inside `relay.StoreEvent`
(`push_notify.go`), which runs on every single incoming WS event — and
that same mutex was held during a blocking disk write
(`add()`/`remove()`/`removeEndpoint()`'s `saveLocked()`). Under real
concurrent production traffic this was enough lock contention to make
WS event handling appear to hang entirely relay-wide (HTTP kept
responding fine throughout, since NIP-11 never touches this code path —
which is exactly why `flyctl status`/HTTP checks looked healthy while
publishes silently died). Confirmed by watching it degrade live, then
fixing it: dispatching the *entire* hook body in a goroutine (not just
the actual push send, which was already async) immediately restored
both HTTP and WS to normal — `nak` reads/writes that had been timing
out with `context deadline exceeded` started working again within
seconds of the fix deploying. **Real lesson, worth remembering
generally**: a `StoreEvent`/`AddEvent` hook on a live relay runs on the
hot path for *every* event, not just the ones it cares about — any lock
taken synchronously inside one, even briefly, is a shared bottleneck for
the whole relay's write throughput, not scoped to just that feature.
The duplicate posts this caused prompted the delete-own-note feature
below, which stayed — a real, independently useful feature regardless
of the root cause.

**Delete own notes — NIP-09, prompted directly by the duplicate-post
incident above (2026-08-05)**: `NoteMenu.tsx` gained a Delete option,
shown only when `event.pubkey` matches the active user (`useActiveUser`,
not a one-time `ndk.activeUser` read, matching this project's standing
signer-switching rule). Publishes a kind:5 deletion event with both the
required `e` tag and the newer-recommended `k` tag (the deleted event's
own kind) per NIP-09. Gated behind an inline confirm panel (not a native
`confirm()` dialog, consistent with this app's fully custom-styled UI)
that's explicit about NIP-09 being a *request*, not a guarantee —
relays may or may not honor it, and the content could already be
mirrored elsewhere. Verified: `tsc -b && vite build` and `oxlint` clean.
Deliberately does **not** try to remove the note from any currently-
loaded feed list client-side (same precedent as like/mute/report
elsewhere in this app, which don't retroactively hide their targets
either) — just marks the button "Deleted" once the request is sent.

**Landing page live at the `nostras.app` apex domain (2026-08-05)**: a
real, previously-unfilled gap — visiting `https://nostras.app/` in a
browser used to 404 (the relay only ever answered NIP-11/WebSocket
requests), so there was no public-facing story anywhere, just the app
itself at `app.nostras.app` for people who already knew to go there.
Scoped via two explicit choices: primary CTA is "open the app directly"
(the app is live and working, so the page's job is mostly building
trust before someone jumps in) rather than a longer explain-first
narrative; and it's served from the apex domain itself rather than a
separate `www.`/`home.` subdomain, so the fix is to the actual reported
gap instead of leaving `nostras.app` still 404ing for a plain visitor.

**Implementation**: `server/landing.html` (a full static page,
`//go:embed`ded into the binary — no separate static-file deploy step,
consistent with this relay having no other asset dependencies) is
served by `landing.go`'s `handleLanding`, registered in `main.go` as
`relay.Router().HandleFunc("GET /{$}", handleLanding)`. **The `/{$}`
matters**: Go 1.22+'s enhanced `ServeMux` treats a bare `"/"` pattern as
a subtree/catch-all match, which would have started swallowing every
other unmatched path (including genuine 404s); `/{$}` matches the exact
root only. khatru's own `ServeHTTP` already routes WebSocket upgrades
and NIP-11 (`Accept: application/nostr+json`) requests to the relay
itself before anything reaches this router, so only a plain browser
visit ever lands on the landing page — verified directly (not assumed):
a plain `GET /` returns the landing HTML, a NIP-11-header request still
returns the correct relay info JSON, and a genuinely unmatched path
(`/some-random-path`) still correctly 404s rather than falling through
to the landing page.

**Design**: drafted first as a Claude-published Artifact and shown to
the user for approval before touching the real codebase — same
precedent as the GitHub README/org profile content earlier in this
project, since this is public-facing brand content, not just scaffolding.
Colors are sampled directly from the real `favicon.svg` gradient
(`#863bff` → `#47bfff`), not invented; the cyan is used as a distinct
"protocol data" accent (NIP badges, the sample-event panel) separate
from the purple brand accent, so protocol details read as information
rather than another call-to-action. Both light and dark themes are
fully styled (dark is the default via `prefers-color-scheme`, matching
the live app's own default). The hero's background is a small canvas
network animation (drifting connected nodes) evoking the actual relay/
mesh model rather than a generic gradient blob, respects
`prefers-reduced-motion`. The feature grid tags each card with its real,
already-shipped NIP number (NIP-46/07 signer, NIP-57/47 zaps, NIP-17
DMs, NIP-90 DVMs, NIP-50/65 search, Web Push) — matching this project's
own convention of using NIP numbers as the shared vocabulary rather than
inventing internal feature names. The "why closed source, still
auditable" section (the original narrative brief from when the docs-only
GitHub org was set up) is illustrated with a real-shaped Nostr event
rather than an abstract claim, reinforcing "the protocol is the audit
surface" concretely instead of just asserting it.

**Verified**: `go build ./...`, `go vet ./...`, and `gofmt -l .` all
clean. Live-tested against a real local relay restart (badger reopened
cleanly, no data loss) — confirmed all three routing cases directly via
curl/`nak` rather than assumed from reading the code: landing page on
plain `GET /`, unaffected NIP-11 response, unaffected WebSocket
relay function, unaffected `/push/subscribe` auth gating, and a genuinely
unmatched path still 404ing. **Confirmed live on the real production
domain in an actual browser after deploying**: `https://nostras.app`
renders the full page correctly — hero with the network animation,
feature grid, audit section with the live-pulse event panel, footer —
and the "Open NOSTRAS" CTA correctly navigates to `app.nostras.app`.
`web`/`dvm` both came back `started` on their own this deploy, no manual
`flyctl machine start` needed this time.

## Stuck blank-page-after-update bug — real root cause found and fixed
(2026-08-06)

User-reported, recurring across many devices/browser profiles at once
(desktop x2, laptop x2, Android, iPhone): after an update, some tabs/PWA
instances would show nothing but the header/logo — an empty page. This
is the same symptom already flagged as a known-but-unfixed quirk in two
earlier entries in this file ("a tab left open across a service-worker-
changing deploy can end up in a bad state"), now recurring often enough
to actually fix rather than just note again.

**Root cause, confirmed by reading `src/sw.ts`/`vite.config.ts`
directly**: the service worker calls `self.skipWaiting()` +
`clientsClaim()`, which makes a newly-deployed service worker take
control of *already-open* tabs immediately, without waiting for them to
close/reopen. But nothing reloaded those tabs when that happened — so
the *old* JS bundle (React, NDK, all in-memory state) kept running,
now served by a *new* service worker it never agreed to run under. This
is a well-known Workbox footgun: `skipWaiting`/`clientsClaim` without a
`controllerchange`-triggered reload is exactly the combination that
causes "silently pull the version rug out from under an open tab" bugs.

**Fixed**: `client/src/lib/swUpdate.ts`'s `installServiceWorkerReload()`
listens for `navigator.serviceWorker`'s `controllerchange` event and
reloads the page once (guarded against a reload loop). Called at the
very top of `main.tsx`, right after the `wsGuard` import. This completes
what `registerType: 'autoUpdate'` was already supposed to mean (silently
get the latest version, no user prompt) — previously it silently got a
new *service worker* but left stale JS running against it, which isn't
actually "updated," just broken.

**Verified for real, not just built clean — a faithful reproduction of
the actual deploy-triggered bug, not just the listener in isolation**:
built the app, served it via `vite preview`, loaded it in a real browser
tab (confirmed the v1 service worker took control), set a JS marker on
`window` to detect a reload, then made a real functional change to
`sw.ts` (not just a comment — comments get stripped by the build and
wouldn't produce a different `sw.js`, caught this on a first attempt)
and rebuilt *in place* into the same served directory, exactly
simulating what a real deploy does to an already-open tab. Triggered a
service worker update check from the still-open tab and confirmed: (1)
the marker was gone afterward, proving a real reload occurred, not
assumed from the absence of an error; (2) the reloaded page rendered
correctly (screenshotted), not stuck blank. `tsc -b`, `vite build`,
`oxlint` all clean.

## Real bug found via load testing: OnDisconnect fires twice per
connection, and the actual scaling bottleneck identified (2026-08-06)

Built a standalone Go load-test tool (outside the repo, not committed —
opens N concurrent WebSocket clients against a relay, each subscribing
to a broad filter and optionally publishing on an interval, reporting
connect/publish success rates and latency percentiles) to get real
numbers before spending on infra, per explicit user request.

**Real bug caught immediately, not shipped**: after the first run (100
clients, all connected then disconnected), the new health dashboard's
`liveConnections` read **-100** instead of 0. Traced to khatru's own
`handlers.go`: a connection's main read-loop goroutine and a separate
ping-ticker goroutine both independently `defer kill()` — so
`OnDisconnect` fires **twice** per real disconnect while `OnConnect`
fires once. Fixed by deduplicating in `server/health.go` via
`khatru.GetConnection(ctx)` (a stable per-connection pointer), guarded
by a plain mutex — connection churn is nowhere near event-storage
frequency, so this doesn't carry the same hot-path risk as `OnEventSaved`.
Re-verified: `liveConnections` returns to exactly 0 after a real 100-
client connect/disconnect cycle.

**Real finding, not assumed**: ran three scenarios against the local
relay, watching the new live health panel throughout.
- **100 clients, light publishing (1 event/8s/client)**: 100% connect
  success, connect latency p50=1.6ms/p99=9ms, publish latency
  p50=29ms/p99=112ms. No stress.
- **500 clients, light publishing (1 event/10s/client)**: connects
  still 100% successful and fast (p50=1.4ms), but publish latency
  exploded — p50=6.6s, p95=17.2s, max=19.9s — with a 37% publish
  failure rate.
- **500 clients, zero publishing (pure subscribers)**: connects 100%
  successful and fast, **no degradation at all**. The "10,000 events
  received" in this run is exactly 500 clients × the 20-event initial
  backfill each subscription requests on open — not live broadcast,
  confirming these connections were genuinely idle.

**Conclusion**: holding many concurrent open connections/subscriptions
is not the bottleneck — connect latency stayed flat and fast at 500
clients regardless of publish load. The actual constraint is
**publish/broadcast fanout under concurrent subscriber load** — every
published event's delivery cost scales with the number of live matching
subscriptions, and that's where the real degradation showed up. This is
architecturally expected for a broadcast-model relay in general, not
necessarily a NOSTRAS-specific bug, but the severity (multi-second
median latency at only ~500 clients / a light publish rate) suggests
real room to investigate khatru's broadcast path specifically before
assuming more concurrent users is fine.

**Important caveat, stated plainly, not glossed over**: this ran on the
local dev sandbox (4 shared cores, `nproc`), with the load-test client
and the relay server competing for the *same* CPU — confirmed real
contention via `uptime`'s load average (5.81 on 4 cores) during the
500-client publish run. This is not a clean, isolated benchmark and the
absolute latency numbers shouldn't be read as "this is what production
will do." The production relay (`shared-cpu-1x`, a single shared vCPU —
*less* than this sandbox's 4 cores) doesn't have this specific
confound (nothing else competes with it there), but also has less raw
CPU to begin with — so if degradation shows up this clearly here, it's
a real signal worth taking seriously, not one to dismiss because the
test environment was imperfect. A cleaner test (relay and load
generator on separate machines, ideally matching the real Fly spec)
would give more trustworthy absolute numbers; this was good enough to
answer "is fanout under load a real risk" with real evidence rather
than pure speculation.

## khatru broadcast-path bug found, patched via a local fork (2026-08-06)

Direct follow-up to the load-test findings above — user asked to dig into
*why* publish latency degraded so badly under concurrent subscriber
load, rather than just accept it or throw a bigger machine at it.

**Root cause, confirmed by reading khatru's actual source (v0.19.1, the
latest release — no newer version exists)**: `listener.go`'s
`notifyListeners` (the function that fans a newly-published event out to
every matching live subscription) writes to each matching listener
**sequentially, one at a time, synchronously on the same goroutine
that's handling the publishing client's EVENT message** — confirmed by
tracing the call site in `handlers.go`, which calls it inline, not via
`go`. Worse: `Relay.WriteWait` (a field with the doc comment "Time
allowed to write a message to the peer," defaulting to 10s) is **never
actually applied anywhere** — grepped the whole package for
`SetWriteDeadline`, zero real usages. So a single slow or stuck
subscriber's blocking `WriteJSON` call could stall delivery to every
other listener, and the publisher's own response, for however long the
OS's own TCP timeout allows — far longer than the 10s the config implies
is happening. This is a real, confirmed defect in khatru itself, not
NOSTRAS's own code, and not something a bigger machine fixes (it's a
blocking-call problem, not a raw-CPU problem).

**Decision: fork and patch locally**, user's explicit choice over
filing upstream-only or just documenting and waiting. khatru is public
domain (Unlicense — verified before touching anything), so copying and
modifying it directly is unrestricted. `server/internal/khatrufork/` is
a full local copy of the package (test files and unused `blossom`/
`policies` subpackages dropped — NOSTRAS doesn't import them) with its
own minimal `go.mod` declaring the same module path
(`github.com/fiatjaf/khatru`), wired in via `replace github.com/fiatjaf/
khatru => ./internal/khatrufork` in `server/go.mod`. No import path
changes needed anywhere else in the codebase — Go's replace directive
redirects module resolution transparently.

**The actual patch** (`internal/khatrufork/listener.go` +
`websocket.go`): `WriteJSONWithDeadline` (new method) applies a real
`SetWriteDeadline` before each write, clearing it afterward so it
doesn't linger and affect a later unrelated write (e.g. a ping) with a
stale expiry. `notifyListeners` dispatches each listener's write
concurrently instead of sequentially, so one slow connection can't block
the rest — bounded by a **relay-wide semaphore** (`Relay.broadcastSem`,
cap 200), not unbounded per-broadcast goroutines.

**Real correction made mid-implementation, not hidden**: the first
version used fully unbounded goroutines (one per matching listener, no
cap). Load-testing this version showed *no improvement* over the
original — in one run, arguably worse (689 failed publishes vs 378
originally, at the same 500-client scenario). Root-caused this
specifically, not just re-measured and shrugged: a burst of simultaneous
publishes (500 clients, many publishing near-concurrently) could each
spawn hundreds of goroutines with zero global limit, adding real
scheduling/allocation overhead on top of the original problem instead of
just fixing it. Fixed by adding the relay-wide `broadcastSem` cap, which
keeps the fan-out concurrent (still solves the original blocking
problem) while bounding total in-flight broadcast writes regardless of
how many publishes land at once.

**Honest limitation, not glossed over**: could not produce a clean local
before/after latency comparison for the *final* (bounded) version.
Discovered mid-investigation that this "sandbox" is actually the user's
own live desktop machine — `ps aux` showed dozens of real Chrome/
Firefox renderer processes, VS Code, and Alby Hub all running
concurrently, with the system at 11GB/15GB memory used and actively
swapping (4.4GB in swap). Between the first and second 500-client test
runs, system load average climbed from 5.81 to 6.86 and **connect
latency alone — completely unrelated to the broadcast patch — grew from
~1-5ms to 43ms median**, proving the machine's own resource state
(likely compounded by this same long session's own accumulated
processes) was degrading independently of any code change and dominated
the measurement. Correctly identified this as a confound rather than
reporting a misleading "still bad, patch didn't help" conclusion from
noisy data.

**What was actually verified, cleanly**: `go build`/`go vet`/`gofmt -l`
clean across the whole module including the fork. A small-scale run (20
clients, well below where system noise dominates) confirmed full
functional correctness post-patch: 100% connect/publish success, fast
latency (connect p50=1ms, publish p50=15ms), and correct event delivery
count (1,600 received = exactly the expected fan-out for 60 publishes
across ~20-27 live subscribers each) — no crashes, no deadlocks, no lost
events. The architectural defect itself (dead `WriteWait`, fully
synchronous fan-out) is proven by direct source inspection, independent
of any benchmark; what's *not* independently proven yet is the precise
magnitude of improvement at real concurrency, since this environment
can't currently produce a trustworthy number for that.

**Next step, deliberately left as a decision point rather than assumed**:
deploy this to production and validate for real using the health
dashboard already built (a genuinely idle production machine, no desktop-
contention confound) rather than keep fighting local noise — or hold and
revisit with a cleaner local environment first. Not yet decided as of
this entry.

**Deploy disaster-recovery process, per explicit user request**: before
touching production with a fix to the relay's hot path, established and
recorded an explicit rollback point — the exact prior commit (`1b6a52b`)
and the exact prior Fly release/image (v13,
`nostras:deployment-01KZAZKHPK3W68TB8G5T82V3D2`) — and independently
re-verified that baseline was genuinely healthy (a real DVM job
round-trip, not just `flyctl status`) before proceeding, since the DVM
had silently stopped again since the last check (the same recurring
pattern, fixed the same way as always). The fix itself was committed as
its own checkpoint (`f0e4ce4`) separate from that baseline.

**Real deploy failure caught immediately, not a repeat of the known
false-negative pattern**: the first deploy attempt failed in 42
seconds — much faster than the usual DVM boot-race false-negative
(1-2 minutes) — which was the first signal this was a *real* build
failure, confirmed by reading the actual GitHub Actions build log rather
than assuming it was the familiar pattern. Root cause: `server/
Dockerfile` copies just `go.mod`/`go.sum` and runs `go mod download`
*before* `COPY . .` (a standard Docker layer-caching optimization), but
a local `replace` directive pointing at a filesystem path
(`./internal/khatrufork`) needs that directory physically present to
resolve — it isn't yet, at that point in the build. Fixed by moving
`COPY . .` before `go mod download`, giving up that specific caching
optimization for a small project where build speed isn't a real
concern. **Verified before pushing again, not just reasoned about**:
Docker's own daemon isn't reachable from this environment (a known,
previously-documented limitation), so instead used `git ls-files` to
copy exactly the tracked files (a faithful stand-in for what Docker's
`COPY . .` pulls in) into a clean temp directory and ran the identical
`go mod download` → `go build` (both binaries) sequence the fixed
Dockerfile now runs — both succeeded cleanly before the second deploy
attempt went out.

## Real root cause found for most of this project's recurring "DVM
stopped" incidents: no reconnection logic at all (2026-08-06)

Found while checking on the version-tracking deploys above — noticed two
failed scheduled `uptime-check.yml` runs earlier the same day and
decided to actually dig in rather than just restart the machine again
and move on, given how many times this exact class of incident has
already been logged in this file across the whole session.

**Root cause, confirmed by reading the DVM's own boot logs directly**:
`cmd/dvm/main.go`'s `main()` ran `for evt := range sub.Events { go
handleJob(...) }` with **no reconnection logic whatsoever**. The moment
the relay connection drops for *any* reason — a network blip, the local
relay restarting, a routine Fly rolling deploy — `sub.Events` closes,
the `for range` loop ends, and since nothing follows it, `main()` just
returns. That's a **clean exit, code 0** — confirmed directly in the
logs (`Main child exited normally with code: 0`) after entirely
unremarkable 20-90 minute runs, no panic, no error. Fly's runner
explicitly does **not** restart a machine that exits cleanly
(`machine exited with exit code 0, not restarting`), unlike a crash —
so the DVM just stayed down silently until the next manual check or
until the scheduled uptime check happened to catch it. This is a
**second, distinct** failure mode from the already-documented boot-vs-
DNS-race panic (that one shows an explicit panic + stack trace on
startup) — this one is a silent, delayed, non-crashing exit that can
happen at any point after a long healthy run, and in hindsight likely
explains a meaningful fraction of every previous "found the DVM stopped
again" entry in this file that didn't have an obvious deploy or panic to
point to.

**Fixed**: extracted the connect→subscribe→consume sequence into
`runDVM()`, which now returns an error (instead of `panic`) on any
connect/subscribe failure or when the subscription simply ends.
`main()` wraps it in an infinite retry loop with exponential backoff
(1s doubling to a 30s cap), resetting back to the 1s base once a
connection has been stable for over a minute — so one old failure
doesn't leave an otherwise-healthy DVM retrying slowly forever. The
DVM's signing identity (`sk`/`pk`) is generated once, **outside** the
retry loop, and stays stable across reconnects — a client that already
received a `payment-required` from this pubkey still gets its result
from the same pubkey after a brief drop, not a new random one it has no
reason to trust.

**Verified for real, not just built clean, reproducing the actual real-
world failure mode directly**: ran the relay and DVM locally, confirmed
a normal connection, then **killed the relay process outright** — the
exact scenario that used to silently end the DVM process. Confirmed via
the log: `relay subscription ended, reconnecting` → repeated `relay
connection lost, reconnecting: ... connection refused` while retrying —
and confirmed independently via `ps`/`pgrep` that **the process stayed
alive** throughout, unlike before this fix. Restarted the relay and
confirmed the DVM reconnected on its own (no manual intervention) and
resumed processing: submitted a real NIP-90 job and got a genuine
`kind:7000` "processing" response back from the **same pubkey** the DVM
started with, confirming the identity-persists-across-reconnects design
worked as intended, not just that *some* connection recovered.

One test artifact worth recording honestly rather than omitting: the
first attempt at this test appeared to hang indefinitely on
`connection refused` even after the relay was confirmed back up via
direct `curl`/`nak` checks — turned out to be a misreading of the log's
own shape (each cycle prints `listening on...` *before* attempting, so
the final unpaired "listening on..." line **is** the success case, not
a stuck failure) confirmed by checking `lsof` for a genuine
`ESTABLISHED` connection and then proving it conclusively with a real
job round-trip, rather than assuming from output that just looked like
a repeat of the previous errors.

`go build`/`go vet`/`gofmt -l` clean throughout.

## Version identification for both client and relay (2026-08-06)

User question, directly prompted by having just watched several deploys
go out this session: how do you tell which build is actually running on
a given client instance or the server, and should that be public.
Previously both sides just had an untouched placeholder — `"0.0.0"` in
both `client/package.json` and `relay.Info.Version` — never bumped,
never meaningful.

**Chose the deploying commit's short git SHA over hand-maintained
semver**, for both sides — zero maintenance overhead on a project
deploying this many times per session, and it uniquely, unambiguously
identifies exactly what code is live, which a manually-bumped version
number would not reliably do here.

**Server**: `relay.Info.Version` (NIP-11 — the standard, public relay-
info mechanism, already existed for exactly this, just never
populated) now reads `NOSTRAS_VERSION` via the existing `envOr` pattern,
defaulting to `"dev"`. Also surfaced on the existing `/dashboard/health`
endpoint for convenience. `server/Dockerfile` gained `ARG
NOSTRAS_VERSION=dev` in the **final** runtime stage specifically (not
the build stage) — it's only ever read via `os.Getenv` at process
startup, and Docker ARGs don't cross a `FROM` boundary regardless.
`.github/workflows/deploy-relay.yml` passes
`--build-arg NOSTRAS_VERSION=$(git rev-parse --short HEAD)` to `flyctl
deploy`.

**Client**: `client/src/lib/version.ts` exports `CLIENT_VERSION` from
`import.meta.env.VITE_GIT_SHA` (same baked-in-at-build-time pattern
already established for `VITE_RELAY_URL`/`VITE_VAPID_PUBLIC_KEY` — no
new mechanism invented). `client/src/hooks/useRelayVersion.ts` fetches
the connected relay's own NIP-11 `version` live via NDK's
`NDKRelay.fetchInfo()` (confirmed via NDK's source this is a plain HTTP
fetch, not dependent on WebSocket connection state — safe to call
regardless of live connection status). Both shown together in a new
"About" section at the bottom of Settings (`AboutSettings.tsx`) —
deliberately plain/unobtrusive placement, not a banner or anything
prominent, since this is a support/debugging detail most users will
never need, but should be easy to find when a bug report does need it.
`.github/workflows/deploy-client.yml` passes the equivalent
`--build-arg VITE_GIT_SHA=...`.

**On "should this be public" specifically**: yes for both, without
reservation. The relay's version is exactly what NIP-11 exists for —
every relay explorer/directory tool already knows to check it, and
withholding it would be unusual, not safer. The client's build SHA
reveals nothing sensitive (this project's actual source lives in a
*private* repo, so the SHA alone doesn't expose browsable source to
anyone) and matches how virtually every app surfaces a build/version
number in its own settings screen.

**Verified for real, end-to-end, not just built clean**: `tsc -b`,
`vite build`, `oxlint` clean on the client; `go build`/`go vet`/
`gofmt -l` clean on the server. Ran the local relay with a fake
`NOSTRAS_VERSION` and confirmed it in both the raw NIP-11 HTTP response
and `/dashboard/health`'s JSON. Ran the local client dev server with a
fake `VITE_GIT_SHA` and confirmed live in a real browser: Settings >
About correctly showed both the fake client build SHA and the fake
relay version fetched from the local relay's real NIP-11 endpoint,
confirming the whole chain (build-time inlining, live NIP-11 fetch,
UI rendering) works together, not just each piece in isolation.

**Real deploy-tooling bug found and fixed the same day, deploying
during a GitHub Actions outage (see the DVM reconnection entry below
for the outage itself)**: with GitHub's Actions runners stuck queued
for 8+ minutes during a confirmed platform-wide major outage, deployed
both the version-tracking commit and the DVM reconnection fix directly
via `flyctl deploy` from this environment instead of waiting on CI —
the identical command the workflow itself runs, just executed locally.
The relay side worked correctly first try (`NOSTRAS_VERSION` correctly
appeared in NIP-11). The **client** side did not: the deployed bundle
had no trace of the git SHA at all, defaulting to the Dockerfile's
`"dev"` fallback despite `--build-arg VITE_GIT_SHA=...` being passed
explicitly. Root cause: `client/fly.toml` has its own `[build.args]`
block (previously only `VITE_RELAY_URL`) — and **`flyctl` only merges
CLI `--build-arg` values for keys already declared there**; a
CLI-supplied arg for a key `fly.toml` doesn't know about is silently
dropped, not merged in. Confirmed empirically, not just from
documentation (flyctl's own `--help` doesn't mention this interaction
at all): added `VITE_GIT_SHA = "dev"` as a default entry to `fly.toml`'s
`[build.args]`, redeployed with the exact same CLI flag, and the git SHA
correctly appeared in the freshly served bundle this time. This affects
the normal CI-driven deploy path too, not just the manual bypass used
tonight — `deploy-client.yml` has been passing `--build-arg
VITE_GIT_SHA=...` since the version-tracking commit went in, and would
have silently never taken effect there either until this same-day fix,
regardless of the GitHub outage.

## Follow button worked inconsistently — two real bugs, not
infrastructure (2026-08-07)

User report, directly following the outbox-aggregation incident above:
clicking Follow on someone else's profile "sometimes works, mostly
doesn't," no visible error. User's own working hypothesis was
infrastructure (Fly idle/waking, shared-machine resource contention).

**Found two real, distinct bugs in `useFollowing.ts`, both silent**:
1. **No guard against toggling before the initial list fetch
   resolved.** `toggle()` builds `nextTags` from the hook's `tags`
   state, which starts as `[]` until `ndk.fetchEvent({kinds:[3], ...})`
   resolves. Since kind:3 is a *replaceable* event, clicking Follow
   before that fetch completed would have published a brand-new list
   containing *only* the one new follow — silently overwriting the
   user's entire real contact list. Not hypothetical: more likely to
   actually trigger for a large list (slower fetch) or a relay under
   load (slower still) — both real conditions for this account, this
   week.
2. **No error handling on the publish, and no `.catch()` at the call
   site either** (`ProfileView.tsx`'s `onClick={() => toggle(...)}`).
   `NDKEvent.publish()` defaults to a 2.5s per-relay timeout — tight
   given the relay's demonstrated occasional latency under load (see the
   outbox-aggregation incident directly above, same day). A publish that
   took just slightly longer became a silent unhandled promise
   rejection: no error shown, local state never updated, button
   silently doesn't change. This is the actual, verified mechanism
   behind "sometimes works, mostly doesn't, no visible error" — not
   infrastructure idling (this app's Fly machines are configured
   `auto_stop_machines = false`, always warm, confirmed already in
   `fly.toml`), though real resource contention under load (which *was*
   confirmed real earlier the same day) plausibly made the 2.5s default
   time out more often than it otherwise would have.

**Fixed**: `toggle()` now refuses to run while the initial fetch is
still `loading` (Follow button shows "…" and is disabled during this
window instead of silently risking data loss). Publish now passes an
explicit 8s timeout (matching this project's other load-related fixes
tonight) and is wrapped in try/catch, exposing a real `error` string the
UI surfaces next to the button instead of swallowing it.

**Found the identical pattern in `useBookmark.ts` and
`useNip65RelayList.ts` too** (same fetch-then-republish shape, same
missing loading-guard and error-handling gaps) — not yet fixed, flagged
to the user as a likely-related follow-up rather than silently expanding
scope beyond what was reported.

**Verified for real, not just built clean**: `tsc -b`, `vite build`,
`oxlint` all clean. Live end-to-end test against the local relay with a
throwaway viewer identity that had a real pre-existing 2-follow list
(with legacy content, matching the same preservation check other
fetch-then-republish hooks were verified against): clicked Follow on a
real target profile, confirmed the button updated correctly and the
follower count incremented, then confirmed via `nak` that the published
kind:3 event contained all 3 tags (the 2 original follows plus the new
one) with the legacy content field byte-for-byte intact — the
preservation logic itself was already correct, only the loading-guard
and error-surfacing were missing. Separately verified the error-
surfacing fix specifically: stopped the local relay, clicked Unfollow,
and confirmed a real, visible error ("Not enough relays received the
event (0 published, 1 required)") appeared next to the button instead
of the previous silent no-op.

## Real production incident: outbox aggregation could starve the whole
relay's connection handling (2026-08-06)

Live user report: `wss://nostras.app` WebSocket handshakes were failing
outright with `context deadline exceeded` — not a slow query, the
connection itself never completed.

**Reproduced immediately, precisely**: a plain kind-only query worked
fine; an authors-filtered query (the only kind that reaches outbox
aggregation) reliably failed. Logs showed a massive, sustained flood of
`NOTICE from wss://nos.lol: 'ERROR: too many concurrent REQs'` —
hundreds within a minute.

**Root cause**: `sys.FetchFeedPage` (go-nostr's own SDK, called from
`server/outbox.go`) processes authors sequentially, one real network
round-trip at a time, with no timeout of its own. A query needing
outbox lookups for several authors against a popular relay could run
uninterrupted for a long time. Under real concurrent traffic this piled
up enough blocked, resource-holding goroutines to starve the relay's
ability to even accept *new* WebSocket connections — unrelated
connections, not just the slow query's own.

**Two fixes shipped, in sequence, each validated before moving to the
next rather than assumed sufficient**:
1. Wrapped the `FetchFeedPage` call in `context.WithTimeout` (8s) — same
   category as the earlier broadcast-path fix, bound worst-case blocking
   instead of leaving it open-ended. This measurably cut the `nos.lol`
   flood rate by roughly 95% (163 occurrences in under a minute, down to
   ~6 over 5 minutes after deploy) — a real, verified improvement — but
   **did not fully resolve the reported symptom**. Retested honestly
   after shipping it, found it still failing intermittently, and kept
   investigating rather than declaring victory on partial evidence.
2. Investigated further and found memory dropping fast under concurrent
   load even with the timeout in place — traced to each concurrent
   `FetchFeedPage` call being able to open several real outbound relay
   connections at once, adding up quickly on this machine's 512MB
   budget. Added a semaphore capping concurrent outbox aggregation
   operations at 6, with a 2s wait before falling back to local-only
   results — the same graceful-degradation principle as the timeout,
   applied to concurrency instead of duration.

**A real self-correction worth recording, not smoothing over**: while
diagnosing this live, ran dozens of rapid-fire test queries against
production in quick succession — itself real concurrent load,
plausibly contributing to some of the instability being diagnosed at
the time, not purely observed from the outside. Also made a genuine
metrics-reading mistake mid-investigation: alarmed at a `MemFree`
reading of ~5-27MB and treated it as severe exhaustion, without
initially cross-checking `MemAvailable` (the metric that actually
reflects reclaimable page-cache memory, which Linux deliberately uses
"free" RAM for). A later, careful re-check found `MemAvailable` was
consistently in a reasonable range (~120-210MB) even when `MemFree`
looked alarming — the earlier severity read was overstated for at least
some of those checkpoints. Corrected the record rather than let an
overstated interpretation stand.

**Verified for real, deliberately minimally this time** (learning from
the point above — a single spaced-out check, not another test barrage):
after the second fix deployed, the exact query pattern that was failing
returned real events correctly. `flyctl status` showed both processes
healthy; `MemAvailable` was in the normal range on a fresh post-deploy
check.

**Honest open point**: given real user-generated load and this
project's own diagnostic testing were intermixed throughout this
incident, the *precise* contribution of each to the observed load
spikes isn't cleanly separable after the fact. The two code fixes are
real, sound, and independently justified by direct source-level
analysis regardless (bounding a previously-unbounded operation is
correct on its own merits) — but "is this now fully resolved under real
production load with zero further tuning needed" isn't something this
session can certify with full confidence, only "meaningfully improved
and verified working in the specific scenario that was reported."

## khatru broadcast-path fix: deployed to production, verified for real
(2026-08-06)

Closing the loop on the entry above — user asked for a disaster-recovery
-conscious deploy process (explicit before/after checkpoints, findings
logged either way) before pushing the broadcast-path fix live.

**Rollback point, recorded before touching anything**: commit `1b6a52b`,
Fly release v13, image `nostras:deployment-01KZAZKHPK3W68TB8G5T82V3D2` —
independently re-verified healthy first (a real DVM job round-trip, not
just `flyctl status`), since the DVM had silently stopped again since
the last check. `git revert` (or `flyctl deploy --image
registry.fly.io/nostras@<that image's digest>` for a faster rollback
that skips CI) against that commit/image is the rollback path if this
fix ever needs undoing.

**Two real deploy failures hit and fixed in sequence, not the same
false-negative reused twice**:
1. A genuine build failure (42s — notably faster than the usual false-
   negative pattern, which was itself a useful signal something
   different was wrong): `server/Dockerfile` ran `go mod download`
   before `COPY . .`, but the new local `replace` directive
   (`./internal/khatrufork`) needs that directory physically present to
   resolve. Fixed by reordering the COPY step; verified before pushing
   again by copying exactly the git-tracked files into a clean
   directory (Docker's own daemon isn't reachable from this
   environment) and running the identical build sequence — succeeded
   cleanly.
2. The familiar false-negative smoke-check pattern on the *next*
   attempt ("the app appears to be crashing" against the DVM machine,
   2m16s this time) — confirmed via `flyctl status` that both `web` and
   `dvm` came up `started` at the new version regardless, matching the
   already-documented boot-vs-DNS race that self-recovers via Fly's own
   crash-restart loop.

**Verified for real in production, not just trusted the status
table**: NIP-11 healthy; a real NIP-90 job round-trip against the DVM
got a genuine `payment-required` response; and — specifically testing
the actual patched code path, not just general liveness — subscribed
live via a real WebSocket connection and confirmed a freshly published
kind:1 note was delivered through the broadcast path in real time.
Checked the relay's own boot log directly: clean start (`NOSTRAS relay
running on :7777`, `dashboard: ON`), no panics, no application errors —
the only errors present were Fly's own proxy layer reporting rate-limit/
lease contention during the machine handover itself, not anything from
NOSTRAS's code.

**One more instance of the standing DVM pattern, unrelated to this
fix**: after the deploy settled, the DVM stopped again on its own with
no new triggering deploy — the same PQ-014-class occurrence already
documented as able to happen with zero triggering event. Fixed the same
way as always (`flyctl machine start`), noted here explicitly so it
isn't mistaken for a symptom of tonight's actual change, which lives in
the `web` process, not `dvm`.

**Status: deployed, live, and functionally verified.** The one thing
still genuinely open is the precise magnitude of the performance
improvement at real concurrency — this environment couldn't produce a
trustworthy local number (see the entry above), and a live production
load test wasn't run as part of this deploy (would mean deliberately
stressing the real user-facing relay, a different risk tradeoff than
local testing). The architectural defect itself remains proven by direct
source inspection, independent of any benchmark.

## Live server health added to the operator dashboard (2026-08-06)

Prompted by a real capacity question (user running ~7 concurrent
instances across 6 devices, asking whether the relay can handle 100-
1000+ later) — before spending on infra, wanted real numbers, and asked
for basic uptime/liveness metrics in the dashboard already built.

`server/health.go`: `sync/atomic` counters only, no mutex — deliberately
matching the lesson from the push-notification lock-contention outage,
since `OnConnect`/`OnDisconnect` run per-connection and `OnEventSaved`
(confirmed by reading khatru's own source, `adding.go`) runs
**synchronously in the same hot path as every event this relay
stores**, immediately after `StoreEvent`. Tracks: live WebSocket
connection count (increment on connect, decrement on disconnect),
process uptime, and a **passive** DVM-activity signal (last-seen
timestamp + all-time count of DVM result/feedback kinds — 6001, 6002,
6050, 7000 — observed passing through). Explicitly documented as *not*
a real liveness check, both in code comments and in the dashboard UI
itself: silence only means no one has submitted a job recently, it
doesn't distinguish that from the DVM actually being down. The real
scheduled liveness check remains `.github/workflows/uptime-check.yml`,
unchanged.

`server/dashboard.go` gained `GET /dashboard/health` (same Basic-Auth
gate as the rest of the dashboard), returning live connection count,
uptime, `runtime.MemStats` (alloc/sys), `runtime.NumGoroutine()`, and
the DVM signal. `dashboard.html` gained a "Server health — live" panel
(pulsing live-dot, matching cards styling already established) polling
this endpoint every 3s — deliberately much faster than the existing
daily-analytics panel's 60s interval, specifically so it's usable as a
live observability view *during* a load test, not just a periodic
glance.

**Verified for real**: `go build`/`go vet`/`gofmt -l` clean. Live
connection count confirmed to increment and decrement to exactly 0
against a real `nak` WebSocket connection opened and closed against the
local relay — not just trusted from code review. Dashboard panel
confirmed rendering correctly and updating live in a real browser: a
`nak` connection opened mid-observation was reflected within one 3s
poll cycle without a manual refresh.

## Real NIP-46 interop bug found and fixed: "failed to connect" against
Amethyst's bunker (2026-08-06)

User report, this time with a full real repro (not the earlier Clave/
iPhone case, which was root-caused to the *other* app's push delivery
and explicitly dropped): on Android, signed into Amethyst, activated its
bunker feature, pasted the `bunker://` URI into NOSTRAS, tapped Connect
in NOSTRAS, received and approved the real push notification from
Amethyst — and NOSTRAS still reported "failed to connect." Traced this
one all the way to a real root cause, not left as "probably the other
app's fault" this time.

**Root cause, confirmed by reading the installed NDK's own source**
(`node_modules/@nostr-dev-kit/ndk`, v3.0.3):
`NDKNip46Signer.blockUntilReady()`'s handling of the `connect` RPC only
treats the literal string `"ack"` as success —
`if (response.result === "ack") { ...resolve... } else { reject(response.error) }`.
Amethyst instead acks `connect` by echoing back the `secret` query
param from the `bunker://` URI, not the bare string `"ack"` — this is
the more secure NIP-46 convention (it proves the responder actually
decrypted and received our specific secret, not just any relay replaying
a generic "ack"), but this NDK version doesn't recognize it as valid at
all, so a real, correctly-approved connection was reported as a failure.
Confirmed this is a genuine ack-shape mismatch and not a real decline by
reasoning through the full request/response cycle in NDK's source
(`NDKNostrRpc`), then proved it directly (see Verified below) rather than
taking the hypothesis on faith.

**Fixed at the application level** (can't safely patch node_modules):
`client/src/lib/remoteSigner.ts` gained
`blockUntilReadyWithAckFallback()` — tries `signer.blockUntilReady()`
first as before, and only on rejection, sends a direct `get_public_key`
RPC (via the signer's own public `getPublicKey()` method) as a second
confirmation. This isn't a weaker check: `get_public_key` only succeeds
if a bunker holding the matching key responds on our private encrypted
response channel, so a genuinely-declined or unreachable bunker fails
this the same way — it specifically recovers the false-negative case
where the bunker *did* approve but acked in a shape this NDK version
doesn't recognize. Wrapped in a 10s timeout so a truly unreachable
bunker fails cleanly instead of hanging forever, and on any failure the
*original* rejection reason is re-thrown (preserving real bunker error
text like "user declined" instead of a generic message) rather than the
fallback's own timeout error. Also had to reach past TypeScript's
`private` marker on `NDKNip46Signer`'s internal `_user` field (a
runtime-only distinction, not real encapsulation) to set it directly:
`ndk.signer = signer`'s setter calls `signer.user()` internally, which
returns `_user` if set or **silently** re-runs `blockUntilReady()`
otherwise (no `.catch()` on that internal call) — without this, the
workaround would appear to work once and then silently re-trigger the
exact same failure (and a second real approval prompt on the phone) the
next time anything read `ndk.activeUser`. Applied to both
`connectBunker()` (fresh connect) and `restoreSignerSession()` (reload),
since both call the same underlying `blockUntilReady()` path.

**Verified for real, end-to-end, against real NDK protocol code — not
just reasoned about**: built a standalone Node script with two real NDK
instances against the local relay — one acting as a bunker that echoes
the `secret` on `connect` exactly like Amethyst does, confirmed
`blockUntilReady()` genuinely rejects (with `undefined`, matching the
generic "failed to connect" text the user actually saw) and the
`get_public_key` fallback then genuinely succeeds with the correct
pubkey. A second script verified the negative case: a bunker that
explicitly declines `connect` *and* never answers `get_public_key`
either — confirmed the flow doesn't hang (fails at the 10s fallback
timeout) and the real decline reason ("user declined") surfaces to the
user rather than a generic message. `tsc -b`, `vite build`, `oxlint` all
clean.

**Confirmed fixed on the real device (2026-08-06)**: user reconnected
from the actual Amethyst app on Android after the deploy — bunker URI
pasted into NOSTRAS, approved on the real push notification, connect
succeeded this time. First real fix in this project's history where the
standalone-script simulation (real NDK classes, real relay, real NIP-44
encryption, but a hand-written fake bunker) was the *only* verification
before shipping, and it correctly predicted real-device behavior —
worth remembering as a validated technique for the next protocol-interop
bug that can't be tested directly (no real device / third-party app
available in this environment).

## Bio links weren't clickable (2026-08-06)

User-reported, immediately after using the new banner/avatar upload
feature for real: a bio containing plain URLs (`https://nostras.app`,
`https://llmops.pro`) rendered them as inert text in `ProfileView`,
unlike note content which already linkifies URLs. Root cause: `about` is
rendered via `{profile.about}` directly — note bodies go through
`parseContentSegments`/`NoteContent`, but the profile bio never did.
Fixed by reusing the exact same `parseContentSegments` (`lib/
parseContent.ts`) already proven correct for notes, via a small
`renderAbout()` helper in `ProfileView.tsx` — every URL-shaped segment
renders as a real `<a>` (shortened display text via the existing
`shortenUrl()`, `note-link` class for consistent styling), and
everything else renders as plain text. Deliberately **not** reusing all
of `NoteContent` (which also embeds images/video/audio inline and
truncates) — a bio isn't a feed post, so image/video URLs in a bio
render as plain clickable links too, not inline media, and there's no
truncation. `.profile-about`'s existing `white-space: pre-wrap` (already
in place, unrelated to this bug) continues to preserve line breaks
correctly since it applies to the whole paragraph regardless of the
inline `<a>`/`<span>` wrapping.

**Verified for real**: `tsc -b`, `vite build`, `oxlint` all clean.
Published a real kind:0 to the local relay with the user's actual bio
text (URLs + blank-line-separated paragraphs, matching their real
content shape) via `nak`, logged into the local dev build as that
identity, and confirmed in a live browser both URLs render as real
clickable purple links and the paragraph breaks are still intact.

## Profile editor: banner/avatar upload, and a real fix for a silent
data-loss bug (2026-08-06)

User-reported gap, with screenshots: the profile editor only ever
exposed name + about, no way to set a banner or avatar image despite
`ProfileView.tsx` already rendering both when present.
`ProfileEditor.tsx` now reuses the exact `uploadToBlossom()` path
`Composer.tsx` already established for note attachments — a click-to-
upload banner strip (gradient placeholder when empty, matching the
brand rather than a blank void) with the avatar overlapping its bottom
edge, same visual language as `ProfileView`'s own `has-banner` layout,
plus a small circular "change photo" button anchored to the avatar's
corner. `about` changed from a single-line `.input` to a multi-line
`.textarea`, matching how bios actually render elsewhere in the app.

**Real, silent data-loss bug found and fixed while doing this, not
hypothetical**: the old `handleSave` published a brand-new kind:0 event
containing *only* `{name, about}` — since kind:0 is a replaceable event,
this meant every save **silently wiped** any other field a user had set
through a different client (`nip05`, `lud16`, `website`, `picture`,
`banner`) the instant they used this app's own profile editor, since
the new event fully replaces the old one rather than merging. This
matches a real, previously-fixed bug class in this project
(`useBookmark`/`useFollowing`/`useNip65RelayList` all already learned
this lesson for their own replaceable kinds) that had never actually
been applied to the profile editor itself. Fixed the same way as those:
`ProfileEditor` now fetches the user's raw kind:0 `content` on mount,
keeps it in state, and `handleSave` spreads it (`{...rawProfile, name,
about, picture, banner}`) rather than replacing wholesale — only the
four fields this form actually edits ever change.

**Verified for real, not just reviewed**: `tsc -b`, `vite build`, and
`oxlint` all clean. In a live local browser: uploaded two distinct real
test images through the actual file input (Chrome's `file_upload` tool)
for both banner and avatar, confirmed both rendered correctly after a
genuine Blossom upload (not mocked). The data-loss fix specifically was
verified end-to-end, not assumed from code review: published a kind:0
via `nak` with `nip05`/`lud16`/`website` set on a throwaway identity,
reloaded the app so the editor fetched that exact raw content, changed
only the name field through the UI, saved, and confirmed via a direct
relay query that the republished event kept `nip05`/`lud16`/`website`
byte-for-byte while only `name` changed — proving the fix, not just the
absence of an error.

## Connection analytics + operator dashboard (2026-08-05)

User-requested — wants visibility into "how many instances of NOSTRAS are
running and from where" to inform marketing strategy. Scoped via explicit
choices before building: the metric is unique relay WebSocket connections
(not app-install pings or published pubkeys — simplest, zero new client
code, at the cost of reconnects/multi-device inflating counts, a known
tradeoff); geography is country-level only, derived from the connecting
IP at connection time with the **IP itself never stored**, only the
resulting country code; the dashboard lives on the relay itself
(`/dashboard`), gated behind a single shared-secret Basic Auth password
(`NOSTRAS_DASHBOARD_PASSWORD`) rather than a full account system, since
none exists in this app and this is operator-only tooling.

`server/analytics.go`: `analyticsStore` is a mutex-guarded, JSON-file-
persisted `{total, by_day: {date: {country: count}}}` structure —
aggregated buckets, not a raw per-connection event log, which keeps
storage bounded regardless of traffic volume and is itself a small
privacy improvement (no per-connection timestamp granularity to
correlate). Wired into khatru's `relay.OnConnect` hook via
`khatru.GetIP(ctx)` (khatru's own helper, already correctly handles
`X-Forwarded-For` for relays running behind a proxy like Fly's, no need
to hand-roll IP extraction). **Applying the PQ-009 lock-contention lesson
directly this time, not rediscovering it**: the geo lookup (an outbound
HTTPS call to `ipapi.co`, free, no API key, returns just a two-letter
country code) and the store write both happen inside a `go func()`
dispatched from the connect hook — never blocking the handshake, exactly
the fix that had to be reactively applied to the push-notification hook
after it caused a real outage. Failures (rate limit, timeout, malformed
response) degrade to an "unknown" bucket rather than blocking or
erroring, consistent with this project's established degrade-gracefully
pattern (DVM pricing, NWC connection, etc.).

`server/dashboard.go` + `dashboard.html`: `/dashboard` (embedded HTML,
`//go:embed`, same pattern as the landing page) and `/dashboard/data`
(JSON snapshot), both behind `requireDashboardAuth` — HTTP Basic Auth
against a single password from `NOSTRAS_DASHBOARD_PASSWORD`, compared via
`crypto/subtle.ConstantTimeCompare` rather than `==` (cheap timing-attack
defense-in-depth). Unset password means the route refuses every request
with 503 rather than serving unprotected — safe-by-default, matching the
same "degrades to off, not to unprotected" posture used for push
notifications and DVM payment gating elsewhere in this project. The page
itself reuses the exact color tokens from `landing.html`
(`--accent`/`--data` purple→cyan gradient, same light/dark
`prefers-color-scheme` pair) for visual consistency with the rest of the
brand: 4 summary cards (total / today / last 7 days / countries reached),
a hand-drawn Canvas bar chart of the last 30 days (no external chart
library, consistent with this project's no-CDN-dependency convention),
and a top-countries table with algorithmically-derived flag emoji
(Unicode regional-indicator arithmetic from the ISO code, no image
assets needed) and gradient progress bars. An honest caption at the
bottom states plainly what is and isn't being measured — same convention
as the relay-list "this pool is dynamic" caption and the search
local-only-scope caption elsewhere in this app.

**Verified for real, not just built clean**: `go build ./...`,
`go vet ./...`, `gofmt -l .` all clean. Auth gating confirmed via direct
curl — no credentials (401), wrong password (401), correct password
(200) — and `/dashboard/data` correctly refuses too. The actual
geo-lookup integration was verified against a real public IP
(`8.8.8.8` → `US` via a direct call to the same `ipapi.co` endpoint the
server uses) to confirm the third-party API genuinely works, separate
from confirming the record-on-connect pipeline itself: triggered several
real `nak` connections against the local relay and confirmed
`analytics.json` accumulated correctly (bucketed as `"unknown"`, which is
the *correct* behavior for a loopback-address connection, not a bug).
The dashboard's rendering (chart + table layout, flag emoji, gradient
bars, responsive card grid) was visually verified in a real browser
against synthetic multi-day/multi-country data generated for this
purpose only in local dev (never written to the production data file,
which is gitignored and lives solely on the Fly volume) — confirmed via
screenshot that the chart renders correctly across 30 days and the
country table sorts and displays correctly with real flag/name/count/bar
rendering.

**Deploy note — password must be set before the dashboard is usable**:
the code deploys with the dashboard correctly OFF until
`NOSTRAS_DASHBOARD_PASSWORD` is set as a Fly secret on the `nostras` app
— this is a manual step, not something this session did, since the user
should choose and know their own password rather than have one invented
and set silently on their behalf.

## Real near-OOM incident: consistent "0 published, 1 required" Follow
failures traced to unbounded connection growth, capped (2026-08-07)

Directly reported by the user: the previous Follow-button fix's new error
message ("Not enough relays received the event (0 published, 1 required)")
was now showing up **every** time they tried to Follow someone, not just
intermittently — and, separately, the Follow button didn't visually update
at all on iPhone Safari even though like/repost worked fine there (that
second, mobile-specific report is still open — see below).

**Root cause, confirmed live, not assumed**: `curl` against
`https://nostras.app/` timed out three times in a row (real, not sandbox
flakiness — retried). SSH'd directly into the `web` machine
(`flyctl ssh console --app nostras --machine <id>` — note this defaults to
the *first* machine in the app, which is `dvm`, not `web`; must pass
`--machine` explicitly to reach the right one) and found the `/app/relay`
process itself was healthy and answered a local request instantly, but
`MemAvailable` was 57MB and, checked again roughly a minute later, had
dropped to 24.6MB — an active, fast decline, not a stable-but-tight
steady state. `ss -tn` showed 305 established connections on port 7777.
Compared to a fresh boot (`MemAvailable` ~327MB, 0 connections
immediately after a restart), that's roughly 1MB of memory per
connection — consistent with WS buffers + goroutine stacks + khatru/NDK
overhead, not a wild outlier.

**No code-level leak found** — khatru's ping/pong keepalive (`PingPeriod`
30s, `PongWait` 60s, both already correctly configured per the earlier
broadcast-path fork work) was reaping genuinely-dead connections as
designed; the log only showed 4 "closing websocket" cleanup events across
~46 minutes of uptime, too few to explain 305 connections as a pile of
undetected zombies. The much more likely explanation, given this relay is
now a real, publicly discoverable domain (linked from the landing page,
advertised via NIP-11, in the docs org): genuine connection volume,
plausibly including the wider Nostr ecosystem's relay-monitoring/crawler
bots (common behavior against any publicly known relay), simply
outgrew the 512MB machine's budget — a capacity problem, not a bug in the
narrow sense. This directly explains why the Follow error went from
intermittent to consistent: the machine was too resource-starved to ack
a publish inside the client's timeout window, for every publish, not just
unlucky ones.

**Immediate mitigation**: `flyctl machine restart 7844157c559e28 --app
nostras` (memory recovered to 327MB available immediately after), then
verified for real — a fresh `nak event -k 3` publish succeeded in 1.2s
(down from 8.3s observed mid-incident, right at the edge of timing out).

**Actual fix, not just a restart**: `server/health.go` gained
`maxLiveConnections = 200` and `tooManyConnections()`, wired into
`server/main.go` via khatru's existing `relay.RejectConnection` hook
(runs *before* the WebSocket upgrade, returns a clean 429) — reusing the
`liveConnections` atomic counter `health.go` already tracked for the
dashboard. Same bound-it-and-degrade-gracefully pattern as
`outboxSem`/`broadcastSem` elsewhere in this codebase: past 200
concurrent connections, new ones are refused outright rather than
accepted and left to compete for memory an existing client's request
depends on. 200 was picked with real headroom below the ~305 that
actually caused the near-OOM state (~100MB+ of margin at the observed
~1MB/connection rate), not right at the edge.

**Verified before deploying, not just built clean**: `go build ./...`,
`go vet ./...`, `gofmt -l .` all clean. The cap's boundary logic was
verified with a temporary scratch test
(`atomic.StoreInt64(&liveConnections, N)` at 199/200/305, asserting
`tooManyConnections()` returns false/true/true) rather than opening 200
real sockets — removed before committing, not shipped. Followed the
standing disaster-recovery process: rollback point recorded before
touching anything (commit `e81319d`, image
`nostras:deployment-01KZCHZZSP6TB6DANN3NJDZWFZ`, machine
`7844157c559e28`), fix committed as its own checkpoint, deployed via
normal CI (succeeded, `web`/`dvm` both came back `started` on their own —
no manual `flyctl machine start` needed this time, unlike several past
incidents), and confirmed functionally afterward: HTTP responds in
0.12s (down from timing out entirely), a fresh publish succeeds in
1.15s.

**Not yet resolved**: the mobile-specific report (Follow button not
visually changing state on iPhone Safari, while like/repost work fine
there) — this incident's root cause (server-side resource exhaustion)
plausibly explains why *any* browser's Follow attempts were failing
during the acute window, but doesn't obviously explain why the *button
itself* wouldn't even show its "Updating…"/error state on iOS
specifically when desktop does. Needs its own investigation, likely in
`ProfileView.tsx`'s button/error-span rendering or event handling under
iOS Safari — not yet started as of this entry.

## Same "0 published, 1 required" error recurred after the connection cap
shipped — real root cause found in badger's own default memory options
(2026-08-07)

Directly following the connection-cap fix above: the user reported the
exact same error again shortly after, on the freshly deployed version.
This time investigation found the connection cap, while a real and
correct fix for its own scenario, was not the whole story.

**Confirmed live the connection-count theory didn't explain this
recurrence**: `/proc/net/tcp` + `/proc/net/tcp6` on the `web` machine
showed only ~78 total connections — nowhere near the 200 cap, and far
below the 305 that caused the first incident — yet `MemAvailable` was
again critically low (11-18MB) and actively declining. Checked the
actual relay process's `VmRSS` directly (`/proc/<pid>/status`, using the
*current* PID — machine restarts reassign PIDs, `ps aux` confirmed which
one was actually `relay` this time): ~400MB resident, matching
`AnonPages` in `/proc/meminfo` almost exactly. This ruled out connection
volume as this incident's driver — the same ~400MB ceiling was reached
in almost the same ~45-minute window as the first incident, despite a
~4x lower connection count, pointing at something time/activity-based
rather than connection-count-based.

**Root cause, confirmed by reading `dgraph-io/badger/v4`'s actual
installed source** (`options.go`, `DefaultOptions`), not assumed:
`badger.DefaultOptions` — used unmodified by
`github.com/fiatjaf/eventstore/badger`'s `BadgerBackend.Init()` — sets
`NumMemtables: 5` × `MemTableSize: 64MB` = up to **320MB** for
memtables alone, plus `BlockCacheSize: 256MB`, plus `IndexCacheSize: 0`.
Per badger's own documented semantics, `IndexCacheSize <= 0` means
table indices are loaded fully into memory with **no bound and no
eviction** — they simply accumulate permanently as the store grows.
These defaults are sized for multi-GB server deployments, not this
machine's 512MB budget, and the memtable + block-cache ceiling alone
(576MB) already exceeds the whole machine before Go's own runtime,
bluge's separate index, or a single live connection are counted. The
unbounded index cache specifically explains the *time-based* growth
pattern: this project's own history already noted local badger boot
times growing (sub-200ms early on, ~5.8s more recently) as the store
accumulates data from ongoing NIP-65 outbox-aggregation caching —
consistent with RSS trending upward over the store's lifetime
regardless of how many clients happen to be connected at any given
moment, which is exactly what distinguished this incident from the
first.

**Fixed**: `server/main.go` now sets `BadgerBackend.BadgerOptionsModifier`
(a hook the `eventstore/badger` package already exposes for exactly this)
to tune memtables down to 3 × 16MB (48MB worst case, from 320MB), the
block cache down to 32MB (from 256MB), and — the specifically bounded
fix — the index cache to a real 32MB LRU-bounded value instead of
unbounded. Worst-case badger footprint drops from ~580MB+ (already over
budget on its own) to roughly 110-150MB, leaving real headroom on the
512MB machine for bluge, the Go runtime, GC slack, and live connections.

**Verified before deploying**: `go build`/`go vet`/`gofmt -l` clean.
Ran locally with the tuned options — relay boots cleanly, a real publish
and a real query both succeed. Followed the same disaster-recovery
process as the connection-cap fix: committed as its own separate
checkpoint (not folded into the earlier commit, so either can be rolled
back independently), deployed via normal CI (succeeded; `web`/`dvm` both
came back `started` on their own), confirmed functionally in
production — HTTP responds in 0.23s, a fresh `nak` publish succeeds in
1.18s, and `MemAvailable` reads 261MB immediately after the fresh boot
(healthy, though — being honest about what is and isn't yet proven —
this specific number only confirms the *fresh-boot* state; the real test
is whether it stays stable over the next 45+ minutes the way it didn't
before, which hadn't been observed yet as of this entry).

**Relationship to the connection-cap fix**: both fixes are independently
correct and worth keeping. The connection cap protects against a
genuine, different failure mode (a real burst of connection volume, as
seen in the first incident) that the badger tuning does nothing to
address; the badger tuning addresses the store's baseline memory
footprint, which the connection cap does nothing to address. Neither
alone was sufficient; this incident is what surfaced that the first fix,
while correct, wasn't the complete picture.

## Analytics + push-subscription stores were silently living on ephemeral
storage, wiped on every restart/redeploy (2026-08-07)

User-reported, noticed on the live dashboard: connection history showed
only a single bar (today), despite the dashboard having been live for
three days. Traced immediately: `NOSTRAS_ANALYTICS_PATH` was never set
in `fly.toml`, so it fell back to `envOr`'s `"./analytics.json"`
default, resolved relative to the Dockerfile's runtime `WORKDIR`
(`/app`), the container's own ephemeral filesystem, not the `/data`
Volume already mounted for badger/bluge. Every machine restart or
redeploy silently reset it to empty, and this session alone had already
caused several (two manual restarts plus multiple deploys while chasing
the near-OOM incidents above), which is exactly why the history looked
wiped.

**Found a second, more serious instance of the identical bug while
checking**: `NOSTRAS_PUSH_SUBSCRIPTIONS_PATH` had the exact same
unset-default problem. This one has real functional impact, not just a
cosmetic dashboard gap: every registered push-notification device
subscription (including the real Android device verified working
end-to-end earlier in this project) was getting silently wiped the same
way, with no error surfaced anywhere. A device would just quietly stop
receiving push notifications until the user happened to reopen Settings
and re-enable it, with nothing in the UI indicating why.

**Fixed via config only, no code change**: both stores already handle a
missing file gracefully (`os.IsNotExist` starts empty, writes on first
save), confirmed by reading `analytics.go`/`push.go` directly, so the
fix was just pointing both paths at `/data` in `fly.toml`'s `[env]`
block, the same persistent Volume `NOSTRAS_BADGER_PATH`/
`NOSTRAS_BLUGE_PATH` already use. Verified with `flyctl config
validate` before deploying.

**Verified live after deploy**: SSH'd into the fresh machine and
confirmed `/data/analytics.json` now exists on the actual mounted
volume (previously invisible from `/data`, since it lived under `/app`
instead). `web`/`dvm` both came back `started` on their own.

**One-time cost, communicated plainly to the user rather than left
implicit**: this move means both files start fresh from this deploy.
Prior analytics history is gone (already effectively true today, given
this session's restarts), and any previously-registered push
subscriptions need a one-time manual re-enable in Settings >
Notifications, since their old registration lived at the now-abandoned
ephemeral path. Going forward, neither file will be lost to a routine
restart or redeploy again.

## Two consecutive badger tuning attempts, one made things worse -- root
cause confirmed to be NumCompactors, reverted to a safer baseline
(2026-08-07)

Direct follow-up to the badger memory-tuning fix above: the user's live
testing hit the exact same error again on the freshly deployed version.
This time a fresh `nak` publish from this session reproduced it
immediately (11.4s, then a mix of slow-but-successful and outright
failed-to-connect attempts) -- a real, currently-reproducible failure,
not a stale report.

**First diagnosis, partially right**: memory itself was healthy
(~235MB available) this time, ruling out a repeat of the memory crisis.
Single-vCPU load average was elevated (2.83) and badger's own periodic
cache-metrics log showed heavy `sets-rejected`/`gets-dropped` counts --
read as the 32MB block cache from the first tuning pass being too small
for real read volume, causing disk-fallback and cache-churn CPU
overhead. **Rebalanced up** (96MB block cache, 64MB index cache,
128MB-worst-case memtables) and, reasoning that 4 compactor goroutines
contending for one real core was itself wasteful, also dropped
`NumCompactors` from badger's default of 4 to 2.

**This rebalance made things measurably worse, not better** -- caught
by re-testing immediately after deploying rather than assuming the
reasoning was sound: within minutes of a fresh boot, single-vCPU load
average hit 5.74 (5-minute average) and connections started failing
*outright* (fast "context deadline exceeded" on connect, not just a
slow publish), before real user traffic could plausibly explain a
spike that fast. **Root cause of the regression**: this machine has
exactly one real core regardless of goroutine count, so *halving*
`NumCompactors` while *simultaneously increasing* memtable size (more
data queued for compaction per cycle) left less effective throughput to
clear a larger backlog -- especially right at boot, when badger is
already reopening existing on-disk tables. Confirmed by direct
before/after comparison of `/proc/loadavg` immediately after each
boot, not just by reasoning about it.

**Reverted, deliberately not attempting a third live guess**:
`NumCompactors` back to badger's default (4), memtable/cache sizes back
to the first pass's values (16MB memtables x3, 32MB block cache, 32MB
index cache) -- not perfectly tuned, but the first pass never produced
outright connection failures the way the rebalance did, only elevated
latency. After two consecutive tuning attempts each had a real negative
production side effect, continuing to hand-tune further knobs live
against production stopped being the responsible next step; if this
baseline still isn't sufficient, the honest next recommendation is more
machine memory (a real recurring cost requiring the user's explicit
sign-off), not a third speculative cache-size guess.

**Verified after the revert**: `/proc/loadavg` right after boot back to
healthy (0.47/0.12/0.04, down from 3.28/5.74/3.01 with the reverted
config). Four consecutive real `nak` publishes all succeeded in
0.6-0.95s each -- the fastest, most consistent latency numbers seen in
this entire session, better even than the original post-restart
baseline.

**Honest framing for the user**: this was communicated plainly as two
consecutive attempts, one of which made things temporarily worse before
being caught and reverted within the same testing window -- not
glossed over as smooth iteration.

## Web process bumped to 1GB memory -- 512MB confirmed too small twice in one day (2026-08-07)

Direct follow-up: the user continued live testing after the revert
above, and a fresh check found the exact same resource-exhaustion
pattern recurring, just slower -- ~2 hours of uptime this time instead
of ~45 minutes. `nak` got a real `429` (the connection cap correctly
enforcing itself, not a hang), and SSH confirmed 223 live connections
(near the 200 cap), `MemAvailable` down to 56MB, and a sustained ~2.0
load average across the full 1/5/15-minute windows -- not a brief spike.

**Correctly read as a capacity signal, not a tuning bug**: the
connection cap and badger memory tuning are both real, working fixes --
they converted what used to be a silent OOM slide into clean, immediate
429 rejections instead of a hung/crashed relay. But real connection
volume (this relay is now publicly discoverable, linked from a real
landing page, drawing genuine Nostr-ecosystem traffic) regularly
approaches what a 512MB machine can sustain. After one tuning attempt
already regressed earlier the same day (the NumCompactors entry above),
continuing to guess at cache-size knobs stopped being the responsible
next step -- the honest recommendation was more memory, a real
recurring cost, explicitly asked of and confirmed by the user before
acting (not assumed).

**Implementation**: `server/fly.toml`'s single `[[vm]]` block split into
two, scoped by `processes` (the same field already used for
`[[mounts]]`) -- `dvm` stays at the original 512MB (it's never shown
this problem and doesn't touch badger/bluge, so no reason to pay for
memory it doesn't need), `web` goes to 1GB. Verified with `flyctl config
validate` before deploying.

**Verified live, not just deployed**: `flyctl machine list` confirmed
the actual running machine is `shared-cpu-1x:1024MB` for `web` and
unchanged `shared-cpu-1x:512MB` for `dvm`. Fresh boot: `MemTotal` now
reads ~985MB (matching the 1GB allocation), `MemAvailable` 616MB right
after boot -- a completely different order of headroom than any prior
check this session. Three consecutive real `nak` publishes all
completed in 0.58-0.69s.

**User's own assessment of this whole chain (2026-08-07)**: after
seeing the last two days of fixes, the user explicitly named the
pattern themselves -- a lot of the individual incidents chased down
this session (outbox-aggregation starvation, connection growth, badger's
oversized defaults, the NumCompactors regression) trace back to the same
underlying cause: the relay's infrastructure (starting at 512MB) was
undersized for what real production traffic actually needed, not a
series of unrelated bugs. Explicitly framed as "test with this memory
improvement for now" -- a possible future CPU upgrade (this machine is
still `shared-cpu-1x`, a shared, not dedicated, vCPU) was raised as a
option to revisit later if the 1GB memory bump alone isn't sufficient,
not something to act on now.

## The deferred CPU upgrade landed the same day -- confirmed shared-vCPU
contention, not memory, moved "web" to a dedicated performance-1x
(2026-08-07)

The "revisit later" above didn't last the day. The exact same publish-
failure symptom recurred roughly two hours after the 1GB memory deploy,
reproduced live via a fresh `nak` publish. This time `MemAvailable`
stayed genuinely healthy (~390MB+) throughout -- the memory fix held,
ruling out a repeat of the earlier OOM pattern outright.

**Root-caused via direct `/proc/stat` sampling, not inferred**: two
consecutive readings a few seconds apart showed `idle` time at 0 and
`steal` time (CPU the hypervisor gave to *other tenants* instead of
this machine) accounting for the overwhelming majority of the window,
with `/proc/loadavg` climbing past 8 on a single shared vCPU. This is
the textbook signature of contention on a `shared` CPU tier -- the
guest OS had work to do and simply wasn't given real CPU time.

**Two mitigation attempts tried live, both failed to help, which is
itself diagnostic evidence**: a plain `flyctl machine restart` did not
reduce load or steal time at all (confirmed via a fresh `/proc/stat`
sample immediately after). A full `flyctl machine stop` +
`machine start` -- which normally has a real chance of rescheduling a
machine onto different underlying hardware, unlike a simple restart --
also didn't help; load climbed even higher afterward (8+ on the 1-min
average). Since a full stop/start didn't escape whatever was causing
this, and the problem reappeared instantly rather than building up
over time, this reads as either sustained contention on this specific
physical host or real regional capacity pressure at the time -- not
something specific to this app's own accumulated state, which a
restart would have reset.

**Explicitly asked the user before acting**, given this is a
meaningfully larger recurring cost than the memory bump -- presented
three options (upgrade to dedicated CPU, try a different Fly region
first, or hold off and keep restarting when it recurs). User chose the
direct fix now that the bottleneck was this clearly diagnosed, rather
than spend more time narrowing down region-vs-host before acting.

**Implementation**: `server/fly.toml`'s `web` `[[vm]]` block changed
from `size = "shared-cpu-1x"` to `size = "performance-1x"`. **Real
deploy failure caught and fixed within the same session, not
pre-empted**: the first deploy attempt failed cleanly (machine left
untouched, stayed on its prior healthy shared-cpu-1x/1GB config) with
`invalid config.guest.memory_mb, minimum required 2048 MiB` --
performance-tier machines have a higher memory floor than shared ones
did. Fixed by bumping memory to 2GB in the same `[[vm]]` block (no
downside, the machine was already comfortably using 1GB) and
redeploying as a separate checkpoint commit.

**Verified live, dramatically, not just "deploy succeeded"**:
`flyctl machine status` confirmed `CPU Kind: performance`, `Memory:
2048`. Three consecutive real `nak` publishes all completed in
1.17-1.25s. `/proc/loadavg` read `0.18 0.11 0.04` (down from 8+
minutes earlier) and a fresh `/proc/stat` sample showed steal time at
effectively zero (1 jiffy over 3 seconds, versus 300+ before) with
idle time healthy again -- the clearest, most unambiguous before/after
contrast of any fix this session.

## Real DVM performance check + a real gap fixed: the operator dashboard
had no DVM metrics at all (2026-08-07)

Direct follow-up to the CPU upgrade above: user asked whether the DVM
machine was still on shared CPU too (it is -- `shared-cpu-1x:512MB`,
deliberately not touched, since it's never shown the contention/OOM
symptoms the relay did and isn't on the hot path for every user's
feed/publish traffic), then pointed at the dashboard's "Server health"
panel and asked why it doesn't show DVM metrics.

**Checked the DVM machine directly first**: `/proc/meminfo` (401MB
available of 469MB total), `/proc/loadavg` (0.00/0.00/0.00), and a
`/proc/stat` steal-time sample (0 delta over 3s) all confirmed
genuinely healthy right now -- no hidden contention.

**Root cause of the dashboard gap**: `/dashboard/health` was always the
*relay* process reporting on itself (`getHealthSnapshot()` in
`health.go`) -- it has zero visibility into the DVM, a separate binary
on a separate Fly machine. The existing "DVM activity" line is a
passive signal (has a DVM-kind event passed through this relay
recently?) that can't distinguish "the DVM is down" from "nobody's
asked it anything," and was never meant to be a real health check —
that's what the scheduled uptime-check workflow is for.

**Fixed by giving the DVM real self-reported health, not by extending
the passive signal**: `server/cmd/dvm/health.go` (new) tracks the DVM's
own uptime, memory, goroutines, jobs received, last-job time, its own
connection status to the relay, and payment-gating state, served on a
small HTTP endpoint. Deliberately private-network-only — the `dvm`
process group has no `[http_service]` block in `fly.toml` at all, so
nothing routes public traffic to this port regardless of what it
listens on, the same safety property the WS protocol port already had.
`server/health.go` gained `fetchDvmHealth()`, hitting that endpoint
over the exact same `<process>.process.<app>.internal` private-network
convention `NOSTRAS_RELAY_URL` already uses in the other direction,
bounded by a 2s client timeout so an unreachable DVM never makes the
dashboard hang -- degrades to `reachable: false` rather than erroring,
consistent with every other optional signal in this codebase.
`dashboard.go` merges it into `/dashboard/health` as a nested `dvm`
object; `dashboard.html` gained a matching "DVM health -- live" panel.

**Real bug caught and fixed before shipping**: the two DVM status
booleans (`relayConnected`, `paymentGating`) initially used
`omitempty`, which drops a field entirely when it's `false` --
indistinguishable from the field being absent because the DVM was
unreachable. Caught via a local end-to-end test (with the DVM's real
`paymentGating: false` silently vanishing from the merged response),
fixed by removing `omitempty` from those two specifically —
`Reachable` stays the one field callers actually branch on to tell "no
data" from "data says false."

**Verified locally end-to-end, then live in production**: local test
confirmed `reachable: false` with the DVM stopped, then `reachable:
true` with real uptime/memory/goroutines once it was running; a real
NIP-90 job submitted via `nak` correctly incremented `jobsHandled` and
populated `lastJobUnix`. Deployed; DVM boot log showed the expected
already-documented boot-vs-DNS race (self-recovered, no manual
intervention) and confirmed the health server started. **Not
independently re-verified via the dashboard UI itself** -- it's Basic-
Auth gated and browser automation can't get past that without
triggering a native auth dialog, which is avoided on purpose; instead
verified with a real functional NIP-90 job against production (real
`payment-required` feedback with a genuine invoice came back, proving
the DVM is alive and subscribed) -- not paid, same standing rule as
always.

## About view reworked from a popup modal to a real nav-rail view (2026-08-07)

Direct user correction after seeing the first version (documented in
the entry above) live: they wanted "just a normal blob that fills the
screen, like the settings icon... or Ask AI" -- not a modal overlaying
the rest of the app, which is what the first implementation had built.
They explicitly offered the simpler fallback themselves: a dedicated
info icon in the nav rail under Settings, if that was more
straightforward than reworking the logo-click behavior.

**Implementation**: `AboutModal.tsx` deleted, replaced with
`AboutView.tsx` -- same content/links/developer-DM/zap section as
before, but rendered as a plain `.card` `view-panel` section exactly
like every other nav-rail destination (Settings, Ask Claude, etc.),
with no backdrop, no close button, no Escape-key handling -- it's a
persistent view navigated away from via the nav rail, not a dismissible
overlay. `'about'` added to `NavRail`'s `View` union; a new `InfoIcon`
(`icons.tsx`) and nav rail button placed under Settings, per the user's
own suggested placement. Both original entry points now work: the
header wordmark (the original ask) and the new info icon both call the
same `setActiveView('about')`.

**Verified in-browser**: both the logo and the new nav icon correctly
open the view; it renders full-width matching Settings' own layout
(confirmed via screenshot, not assumed); the nav rail's active-state
highlighting correctly applies to the new icon; content is unchanged
from the modal version, just the container changed. Deployed and
confirmed live: the production bundle contains the new `about-view`
class and has zero remaining references to the deleted
`modal-backdrop` class.

## Rebroadcast action + articles finally got a menu (2026-08-07)

User-reported gap, hit for real on their own published article: after
publishing an article (local-only, per `devPublishRelaySet`'s standing
default), they opted a public relay into this session's publish targets
via Settings > Relays — but there was no way to actually get the
already-published article out to it. "No icon to republish on the blob
nor on the article." Root cause, confirmed by reading both components
directly: `ArticleCard.tsx` and `ArticleView.tsx` never rendered
`NoteMenu` at all — articles had zero actions (no copy link, no raw
event, nothing), unlike every other content type in the app.

**Fixed in two parts.** First, `NoteMenu` gained a new "Rebroadcast to
current relays" action (`client/src/components/NoteMenu.tsx`): calling
`event.publish(devPublishRelaySet)` again on an already-signed `NDKEvent`
just re-sends the exact same bytes (same id/sig, no re-signing) to
whatever relays are currently active publish targets — this is a real,
correct rebroadcast, not a new version of the event. Second, `NoteMenu`
was wired into both `ArticleCard.tsx` (positioned absolutely in the
card's top-right corner, outside the card's own big clickable button,
since a button can't nest inside a button) and `ArticleView.tsx`
(alongside the author row) — so articles now get the full menu
(copy id/npub/link/content, view raw event, rebroadcast, report, mute)
that every other note type already had.

**Verified end-to-end in local dev, not just built clean**: `tsc -b`,
`vite build`, `oxlint` all clean. Published a real throwaway-signed
kind:30023 article directly to the local relay via `nak`, found it via
Search's new pubkey-lookup path, confirmed the "..." menu now renders on
both the article card and the full article view (previously totally
absent), and clicked "Rebroadcast to current relays" — confirmed via
direct DOM inspection (not a screenshot, which kept missing the
transient state) that the button correctly settled on "Rebroadcast ✓",
disabled, with no error span rendered, matching the same busy/done/error
pattern already used elsewhere in this component. Deployed via the usual
CI path and confirmed live: the production bundle at `app.nostras.app`
contains both the new `"Rebroadcast to current relays"` string and the
`article-card-menu` class.

## Rebroadcast became a curated relay picker (2026-08-07)

Direct follow-up, same day: after using the plain rebroadcast button on
their own real published article and confirming it worked, the user
found Yakihonne (a different Nostr client, used on their iPhone for a
second identity with 400+ followers) has its own "republish" feature
that offers a checklist of 30+ relays to pick from, not one implicit
target — and asked for NOSTRAS to build the same.

**Implementation**: `client/src/lib/curatedRelays.ts` is a new,
deliberately hardcoded/trusted list of 15 well-known public relays
(`relay.damus.io`, `relay.primal.net`, `nos.lol`, `relay.nostr.band`,
`nostr.wine`, `relay.snort.social`, `purplepag.es`, `eden.nostr.land`,
`relay.nostr.bg`, `nostr21.com`, `relay.current.fyi`, `offchain.pub`,
`nostr.mom`, `relayable.org`, `nostr.oxtr.dev`) — not fetched or
user-submitted, since Settings > Relays already covers adding arbitrary
custom relays for anyone who wants a longer/different list.
`NoteMenu.tsx`'s single-click "Rebroadcast to current relays" action
(added earlier the same day) became "Rebroadcast to relays…", which
opens a new picker panel (reusing the existing fixed-position centered
`.note-menu-panel` modal pattern, since a 15-relay checklist can get
tall): a checkbox per curated relay (all pre-checked by default), plus
Select all/Select none, plus a submit button whose label live-updates
with the selected count (`Rebroadcast to N relays`). Submitting builds a
fresh `NDKRelaySet.fromRelayUrls(urls, ndk)` from just the checked URLs
and calls `event.publish(relaySet, 8000)` — the same already-signed-event
rebroadcast mechanism as before (same id/sig, no re-signing), just
against a picker-selected set instead of the fixed
`devPublishRelaySet`. **Deliberately a separate mechanism from
`devPublishRelaySet`/Settings > Relays**, not a reuse of it — this is a
one-off "get this specific note or article more reach" action, not the
app's standing local-only-by-default publish scope, and the two should
stay conceptually distinct. The curated URLs are pre-filtered through
`makeRelayConnectionFilter` (`relayFilter.ts`) before
`NDKRelaySet.fromRelayUrls` even though they're a trusted hardcoded
constant, not untrusted third-party data — matching this codebase's
standing rule (learned from the DM recipient-relay-discovery work) that
`fromRelayUrls` constructs `NDKRelay` objects unconditionally and
bypasses the pool-level filter entirely, so pre-filtering at the call
site is cheap, correct insurance regardless of the source.

**Verified live in local dev, not just built clean**: `tsc -b`,
`vite build`, `oxlint` all clean. Found a real, unrelated leftover from
earlier the same day while restarting the local relay for this test: an
old `go run .` process's *compiled child binary* had outlived the
wrapper process a prior cleanup killed, still holding the badger lock
and port 7777 — a real instance of "killing `go run .` doesn't
necessarily kill what it spawned," not a code bug, fixed by finding and
killing the actual binary via `lsof -i :7777` before restarting cleanly.
The picker itself was verified end-to-end against a real live note in
the real public feed, via direct DOM interaction (more reliable than
screenshots for catching transient state, same lesson as the plain
rebroadcast button's own verification): confirmed all 15 relays render
pre-checked and the submit label reads "Rebroadcast to 15 relays";
toggling two checkboxes off correctly drops both the checked count and
the button label to 13; "Select none" correctly zeroes the count and
disables the submit button; "Select all" correctly restores all 15;
"Close" correctly tears down the panel and backdrop with no residual
state. **Deliberately did not click the actual submit button during
this test** — doing so from a real live public note would have sent
real test traffic to real third-party public relay operators, which
this project has consistently avoided throughout (matching the
precedent set by the publish-target-toggle work: "verified without ever
publishing a real note to a public relay, doing so would itself violate
the safety property being tested"). The underlying `event.publish(relaySet,
timeoutMs)` call and the `makeRelayConnectionFilter` reuse are both
already-proven code paths (the former just confirmed working minutes
earlier via the user's own real click on their real article; the latter
already unit-verified across 11 cases during the "Not Secure" bug fix) —
only the new UI-side selection logic needed fresh verification, and it
was. Deployed via the usual CI path and confirmed live: the production
bundle at `app.nostras.app` contains `"Rebroadcast to relays"`,
`relay.damus.io`, and the `rebroadcast-relay-list` class.

**Per-relay success/fail indicators added the same day**, directly
prompted by the user seeing a real "15 selected, 7 successful" result
and wanting to know *which* 7. NDK's own `NDKRelayPublisher.publish()`
emits `"relay:published"` / `"relay:publish:failed"` on the `NDKEvent`
itself as each individual relay in a batch resolves — independent of,
and earlier than, the aggregate `NDKRelaySet.publish()` promise the
picker already awaited for its final count. `NoteMenu.tsx`'s
`handleRebroadcast` now registers both listeners right before
publishing and tears them down in a `finally`, tracking a
`relayResults: Record<string, 'pending' | 'success' | 'failed'>` state
keyed by `normalizeRelayUrl` (the form `NDKRelay.url` is always in —
adds a trailing slash the raw curated URL strings don't have). Each
checked relay row shows a live `…` → `✓`/`✕` next to it as results come
in; any relay still `pending` once the whole batch resolves (never
connected in time, rather than an explicit rejection) is swept to
`failed` as a safety net so nothing hangs indefinitely in the UI.
Checkboxes and Select all/Select none are disabled mid-publish to avoid
a confusing selection change while results are actively streaming in.

**Verified live in local dev with a real, controlled success/fail
pair** — not against real production relays, which would have meant
sending real test traffic to third-party operators just to watch it
fail, the same restraint applied throughout this feature's testing.
Temporarily swapped `CURATED_RELAYS` to two entries only (the local
relay, guaranteed to succeed instantly; a deliberately nonexistent
hostname, guaranteed to fail after the timeout), confirmed via direct
DOM inspection that the local relay's row showed `✓` within 300ms while
the bogus one still showed the pending `…`, then confirmed after the
full 8s timeout that the bogus one correctly flipped to `✕` and the
submit button correctly read `Rebroadcast ✓ (1)` — proving the
live-streaming update, the timeout-driven fallback-to-failed logic, and
the final count all work together correctly. Reverted `CURATED_RELAYS`
back to the real 15-relay list immediately after (confirmed via `git
checkout`) before committing. `tsc -b`, `vite build`, `oxlint` all
clean. Deployed via the usual CI path and confirmed live: the
production CSS bundle at `app.nostras.app` contains
`relay-result-success` and `relay-result-pending`, and the JS bundle
contains `relay:publish:failed`.

## Ask Claude nav icon redesigned, card avatar dropped, real explainer
copy added (2026-08-08)

User feedback on the Ask Claude card: the nav rail's single-star
`SparkleIcon` read too much like a generic decoration rather than a
feature affordance, the card's own circular avatar (same icon, right
next to the nav rail one) was redundant and added nothing, and the
card's copy never actually explained what it was or what it cost —
just "Ask anything…" and a bare model name.

**Icon**: `SparkleIcon` (single eight-point burst) replaced everywhere
by a new `SparklesIcon` (a two-star cluster — one large star plus a
smaller companion) in `icons.tsx`, matching the visual shorthand most
AI products use and staying distinct at nav-rail size from a plain
single burst. `NavRail.tsx` updated to use it; `AskClaudeCard.tsx`'s
`.ask-claude-avatar` circle removed entirely (and its now-dead CSS)
rather than swapped, since `composer-body` alone in the flex row
already fills the space correctly with no layout change needed.

**Copy**: added a short explainer above the textarea naming the actual
mechanism and value prop for this audience — "Powered by a NIP-90 Data
Vending Machine — a Claude worker that takes jobs over Nostr and gets
paid in sats, per question. No account, no subscription, nothing
retained beyond your prompt. Job doesn't finish, you don't pay." Chosen
over two longer alternatives drafted first (a more audience-value-
forward paragraph, and a one-line tagline) as the best balance of
teaching the NIP-90 mechanic by name while staying short enough to fit
above the existing "Model: claude-opus-5" line rather than replacing it.

**Verified live in local dev**: `tsc -b`, `vite build`, `oxlint` all
clean; confirmed in a real browser that the nav icon renders crisply as
a genuine two-star cluster at actual nav-rail size (zoomed screenshot,
not just eyeballed at full size), and that the card renders the new
copy with no layout issues. Deployed via the usual CI path; confirmed
live via the production bundle containing the new explainer string and
zero remaining occurrences of the old `ask-claude-avatar` class (a
first grep check was a false positive from broken shell-pipeline exit-
code logic — `head -1` on empty input still exits 0 — caught and
re-verified with a proper `grep -c` count before trusting the result).

## DVM outage: alive but unable to mint invoices — NWC connection to the
wallet's relay dropped, not the usual "process silently exited" pattern
(2026-08-08)

Found while routinely checking DVM health after unrelated distribution
work — `flyctl status --app nostras` showed the `dvm` machine as
`started`, which past incidents in this file already established isn't
sufficient proof of a working DVM. Sent a real `kind:5050` job via `nak`
to confirm, and got a genuine `kind:7000` response back — but `status:
error`, `content: "could not create invoice: not connected to
wss://relay.getalby.com"`. This is a **new, distinct failure mode** from
every previous DVM incident logged in this file: the process itself was
genuinely up, correctly subscribed, and correctly received/processed the
job — only its NWC connection to the operator wallet's relay
(`relay.getalby.com`) had dropped, so `make_invoice` had nowhere to go.
Every real paid job request during this window would have failed with
an explicit error rather than the usual silent non-response.

**Fixed the standard way**: `flyctl machine restart` on the `dvm`
machine (`48ee96ece456e8`). **Verified for real, not just via
`flyctl status`**: a fresh `kind:5050` test job after the restart got a
genuine `payment-required` with a real bolt11 invoice (confirming the
NWC connection came back), followed by the correct `"payment not
received in time"` error exactly 2 minutes later since the invoice was
deliberately never paid — same standing rule as every other DVM
verification in this project, Claude only ever triggers the
request/invoice side.

**Worth remembering alongside the other DVM incidents in this file**:
`flyctl status` showing `started` now has at least three known failure
modes that still look healthy from the outside — the boot-vs-DNS race
(self-recovers), the silent clean-exit-on-disconnect bug (fixed via the
DVM reconnection-loop rewrite), and now a dropped NWC relay connection
specific to the payment path. A real job round-trip remains the only
verification that actually distinguishes "healthy" from "running but
broken," which is exactly why `uptime-check.yml` exercises one instead
of a plain HTTP ping.

## DVM advertised via NIP-89/NIP-90 handler announcements — a real
distribution channel, not just an in-app feature (2026-08-08)

Prompted by reviewing a strategy analysis identifying NIP-89 and NIP-90
service-provider announcements as low-effort "enablers" for the DVM's
distribution — independent of, and much smaller than, the still-open
question of ever open-sourcing the client itself. `server/cmd/dvm/
main.go` gained `publishHandlerAnnouncement`, called once per relay
connection inside `runDVM` (so it also republishes — and self-heals —
on every reconnect the DVM's own retry loop already performs). Per
NIP-90's own "Service provider discoverability" appendix: a single
kind:31990 event with one `k` tag per supported job kind (5001
summarize, 5002 translate, 5050 ask) and kind:0-style JSON content
(name/about/picture/website). This is the mechanism that turns the DVM
from "a feature inside NOSTRAS" into a standalone protocol service any
NIP-90-aware client or marketplace can discover and pay directly,
without ever installing the app.

**Real spec detail confirmed by fetching the actual NIP text before
writing any code, not assumed from memory**: kind:31990's `d` tag is
just a stable identifier for the handler event itself (used for `a`-tag
addressing), not the job kind — that's what distinguishes it from
kind:31989's `d` tag, which *is* the job kind. Content is deliberately
static (a representative price band, "typically a few dozen sats") since
the DVM's real price is computed dynamically per job from live token
count + BTC/USD rate — a cached public announcement can't show a live
number without risking it going stale.

**Verified for real, twice**: locally, confirmed the event's exact tag
shape via `nak req -k 31990 -a <dvm-pubkey>` against the local relay,
then killed and restarted *just the relay* (keeping the same DVM process
and identity running) to confirm the DVM's existing reconnect loop
republishes it automatically — refetched and confirmed exactly one
event still existed with a fresh `created_at`, no duplicate, proving the
relay's parameterized-replaceable handling (kind 30000–39999 range)
works correctly here. Cleaned up an unrelated stray local DVM process
left running since 2026-08-06 (an old `go build` binary from much
earlier in a prior session that never got killed) while at it. `go
build`, `go vet`, `gofmt -l` all clean. Deployed via the usual CI path;
`flyctl status` confirmed both `web` and `dvm` came back `started` at
the new version, and a direct `nak req -k 31990 wss://nostras.app`
against production confirmed the real DVM identity is publishing the
announcement with the correct tags and content live.

## NOSTRAS advertised as a NIP-23 handler too, plus a real client-side
outbox bug found only by testing against production (2026-08-08)

Direct follow-up, same session: a second kind:31990 (`server/cmd/dvm/
main.go`, same DVM identity, `d` tag `nostras-client` instead of
`nostras-dvm`) advertising NOSTRAS the *client* as a kind:30023
(long-form article) handler — the genuinely differentiated view
capability, deliberately not also claiming kind:0/1 which every
baseline client already handles and isn't the "unknown event-kind"
scenario NIP-89 exists for. Its `web` tag
(`https://app.nostras.app/?nostr=<bech32>`) only has real value if that
URL actually resolves, so `client/src/lib/deeplink.ts` (new) parses a
`?nostr=<naddr1...>` query param on boot and turns it into a real
`viewArticle()` navigation, wired into `App.tsx` once the relay pool is
connected and a signer is settled.

**Real bug caught only by testing against the actual deployed site, not
local dev — worth remembering as a general lesson, not just this
feature**: the naddr redirect worked perfectly in local dev (including
local dev deliberately pointed at the real production relay via
`VITE_RELAY_URL=wss://nostras.app`, to rule out a relay-side cause) but
silently failed — no thrown error, just no navigation — on the actual
deployed `app.nostras.app`, reproduced consistently across multiple
fresh tabs. Root cause, found by reading NDK's own behavior rather than
guessing: `deeplink.ts`'s query has `authors` set
(`{kinds:[30023], authors:[pubkey], '#d':[identifier]}`), and an
authors-filtered `fetchEvent` with no explicit relay set can trigger
NDK's own client-side outbox-relay resolution — for a throwaway test
key with no discoverable NIP-65 list, that resolution finds nothing,
and returns null silently instead of falling back to the app's own
configured relay pool. This is the same general class of NDK behavior
already documented twice elsewhere in this file (the "Not Secure"
private-relay bug, the DM recipient-relay-discovery security fix) —
**any `authors`-filtered NDK query with no explicit relay set is a
candidate for this**, not just this one call site.

**Fixed by scoping the query to `localRelaySet` explicitly** (NOSTRAS's
own relay) rather than leaving relay selection to NDK. This loses no
real capability: `server/outbox.go` already fans out to an author's
true write relays for any authors-filtered query the *relay* receives,
so cross-relay discovery still happens — just through the server-side
path already proven correct elsewhere in this project, instead of
NDK's less reliable client-side equivalent.

**Verified for real, end to end, against the actual deployed site three
times** (not just re-trusting the fix from code review): published a
real kind:30023 article directly to `wss://nostras.app` via `nak` with
a throwaway key, encoded its naddr, and confirmed the *first* attempt
against the live site failed (landed on the home feed, no article) —
reproducing the real bug before fixing it. After deploying the fix,
retested the identical URL against the exact same tab that had just
failed, and separately against two more fresh tabs, and all three
correctly resolved to the article. `tsc -b`, `vite build`, `oxlint`,
`go build`, `go vet`, `gofmt -l` all clean throughout. Deployed relay +
client via the usual CI path; `flyctl status` confirmed `web`/`dvm`
both `started`, and `nak req -k 31990 -t d=nostras-client
wss://nostras.app` confirmed the client handler announcement is live
with the correct `k`/`web` tags.

## Profile Following/Followers counts made clickable, with a follow-list
modal (2026-08-08)

User request: viewing someone's profile showed Following/Followers
counts as plain text, with no way to see who's actually on either list
or follow someone from it. `useFollowCounts.ts` was already fetching/
subscribing to both lists to produce the counts, just discarding the
actual pubkeys — now exposes `followingPubkeys`/`followerPubkeys`
alongside the existing counts, so `FollowListModal.tsx` (new) costs no
extra query when opened. The modal reuses the exact fixed-centered
`.note-menu-panel` pattern already established for NoteMenu's raw/
report/delete-confirm panels, widened to 360px for a comfortable list.

Each row calls `useFollowing()` **once at the modal's top level**, not
once per row — passed down as `isFollowing`/`toggle`/`busy` — matching
this project's own standing lesson (from the DM conversation-list
duplicate-subscription bug) about what happens when a hook that opens
real state/subscriptions gets called once per list item instead of
once per list. A row for the active user's own pubkey (which can
legitimately appear in someone else's following or followers list)
shows "You" instead of a Follow button, since following yourself isn't
a real action. Clicking a row's avatar/name closes the modal and
navigates to that person's profile via the existing `viewProfile()`.

**Verified end-to-end in local dev with real relay state, not mocked**:
four throwaway identities — a target profile following two accounts,
and a third account following the target back — published directly to
the local relay. Opening "Following" showed both real followed
accounts with working Follow buttons; clicking Follow on one published
a real `kind:3` event, confirmed via direct relay query, that correctly
preserved the dev-key identity's existing follows *and* its legacy
non-standard content field, adding only the one new `p` tag — the same
tag-preservation behavior `useFollowing.ts` already guaranteed,
now proven through this new entry point too. Opening "Followers"
correctly showed the real following-back account (briefly showing a
truncated pubkey before its profile finished fetching — expected cache
behavior, not a bug, confirmed by re-checking after the fetch
resolved). `tsc -b`, `vite build`, `oxlint` all clean. Deployed via the
usual CI path; confirmed live via the production bundle containing the
`follow-list-modal` class.

## Real Log off action added — there was previously no way to log off
at all (2026-08-08)

User-reported gap: nothing in Settings actually returned to AuthGate's
initial choice screen. The existing Signer "Disconnect" button
(`remoteSigner.ts`, predates `AuthGate`) is scoped specifically to
swapping *away from* a NIP-46/07 signer, and silently falls back to
the dev key rather than presenting a real choice — and there was no
disconnect/logoff affordance at all for someone already on the dev-key
path, since `SignerConnect.tsx` only renders its connected/disconnect
UI when a saved remote-signer mode exists.

**Implementation**: `client/src/lib/authState.ts` (new) moves
`authState` out of `App.tsx`'s local `useState` into a shared
module-level store — same `useSyncExternalStore` pattern already used
by `lib/navigation.ts` — since the new `logOff()` needs to flip it
back to `'needs-choice'` from deep inside the settings panel
(`AccountSettings.tsx`, a new bottom-of-Settings section) without
prop-drilling a callback down through every intermediate component.
`logOff()` clears any NIP-46/07 session (`remoteSigner.ts` gained an
exported `clearSignerSession()`, split out from `disconnectSigner()`
so logging off doesn't inherit its dev-key-fallback behavior) and sets
`ndk.signer = undefined`, then flips `authState` — AuthGate renders
immediately, no page reload needed, since the whole `<main>` block is
gated on `state === 'connected' && authState === 'ready'` and
unmounts/remounts cleanly off that condition already.

**Deliberately does not delete the dev-key identity from
localStorage** — `signer.ts`'s `getDevSigner()` already returns the
existing key if one is present rather than minting a fresh one, so
choosing "Continue anonymously" again after logging off seamlessly
restores the exact same identity. Actually forgetting a key forever
would be a much more consequential, separate action, not something a
plain "log off" should do as a side effect — this was a deliberate
scope decision, not an oversight.

**Verified live in local dev, not just built clean**: `tsc -b`,
`vite build`, `oxlint` all clean. Logged in with the dev-key identity,
confirmed the `nsec` in `localStorage` before clicking Log off,
confirmed AuthGate rendered immediately in the same session, clicked
"Continue anonymously" again, and confirmed the exact same `nsec`
prefix was restored (not regenerated) — proving both halves of the
behavior, not just the visible transition. Deployed via the usual CI
path; confirmed live via the production bundle containing the "Log
off" string.

## Key import + multi-identity switching, closing a real philosophical gap
in the non-custodial manifesto (2026-08-08)

User-raised inconsistency: NOSTRAS already generates and displays a raw
nsec client-side for "Create new account" — so a user who saves that key
safely, logs off, creates a second identity, and wants to switch back to
the first one had no way to do it. The project's non-custodial stance
("we don't keep anyone's nsec") holds regardless of whether a key was
generated here or pasted in — the server never sees either — so the gap
was purely a missing UI affordance, not a philosophy conflict. The real
risk in adding key-paste is a UI-hygiene one: "paste your nsec into this
website" is a known phishing pattern in the Nostr community, exactly why
NIP-46/NIP-07 exist. User's explicit call: "Build both" — an import path
*and* a genuine multi-identity switcher, not just an overwrite-the-
current-key box.

**`client/src/lib/identities.ts`** (new) replaces the old single-key
`signer.ts` (deleted) with a real multi-identity store:
`nostras:identities` (a `LocalIdentity[]` — npub, nsec, label,
createdAt, `imported: boolean`) + `nostras:active-identity`. **Migrates
the old single-key format forward**, lazily on first access
(`migrateLegacyIfNeeded()`, guarded so it only runs once per page load)
— real production users already had a real identity under the old
`nostras:dev-signer-nsec` key, so this had to migrate, not just support
fresh installs; the legacy key is left in place afterward, unused, as a
safety net rather than deleted. `importIdentity()` relies on
`NDKPrivateKeySigner`'s own constructor validation (confirmed by reading
NDK's compiled source: it throws synchronously for a malformed key) to
surface a real error rather than silently failing, and rejects
re-importing a key already saved.

**`AuthGate.tsx`**'s login step gained a collapsed-by-default "Import an
existing key instead (advanced)" section — deliberately not a peer
option to Log in/Create account, since normalizing key-paste as an
equally-easy first choice would undercut the exact phishing-resistance
NIP-46/07 exist for. Expanding it shows an explicit warning (a bunker/
extension never exposes the key to the page at all; this path does,
and only the user can judge whether the device is trustworthy) above a
masked (`type="password"`) input.

**`client/src/components/IdentitySettings.tsx`** (new), wired into
Settings as "Identities" (placed directly above Signer, since the
"created" step's copy points here as "Settings > Identities") — lists
every saved identity with an editable label, truncated npub, an
"imported" tag when applicable, and Switch/Active state; Create new
identity (reveals the fresh nsec inline, same warn-and-copy pattern as
AuthGate's own "created" step) and Import existing key (same masked-
input-plus-warning pattern) at the bottom; Remove behind an inline
confirm/cancel, never a native `confirm()`.

**Switching always clears any active NIP-46/07 session first**
(`clearSignerSession()`), not just cosmetic — `App.tsx`'s boot
resolution checks for a saved remote-signer session *before* falling
back to a local identity, so leaving one in place would mean a switch
silently reverted back to the bunker/extension on the next reload
instead of sticking. The label `<input>` is deliberately **not** fully
controlled by the persisted identity list on every keystroke — typing
updates local component state only, and the actual `renameIdentity()`
persist-and-refresh happens on blur; an earlier version called
`refresh()` (which re-reads from storage) on every keystroke, which
meant clearing the field to type a new label would immediately snap
back to the old one the instant the input became empty, since an empty
label is deliberately ignored by `renameIdentity()`.

**Verified live in local dev, every real path, not just built clean**:
`tsc -b`, `vite build`, `oxlint` all clean (one pre-existing unrelated
lint warning, untouched by this change). In a real browser with
localStorage cleared: the malformed-key error path (NDK's own bech32
decode error surfaces directly, not swallowed); a real hex-format key
import (`NDKPrivateKeySigner` accepts hex or bech32) landing straight in
the app; Settings > Identities showing it correctly tagged "imported"
and Active; Create new identity revealing a fresh nsec and adding a
second, now-active identity; Switch correctly flipping Active between
the two; **persistence across a real reload** (confirmed via
localStorage inspection, not just the UI) — reloading after a switch
skipped AuthGate entirely and booted into the switched-to identity, the
exact behavior `clearSignerSession()` exists to guarantee; rename (blur-
commit, confirmed not fighting mid-edit); remove-with-confirm (inline
Confirm/Cancel, then actual removal). **The legacy migration path was
independently verified too**: cleared storage, hand-set only the old
`nostras:dev-signer-nsec` key, reloaded, and confirmed it appeared as
"My identity" (the correct derived npub, `imported: false`) already
Active, booting straight past AuthGate — and confirmed via direct
localStorage inspection that the legacy key was preserved untouched
alongside the new `nostras:identities` array, not deleted. Also fixed a
stale copy bug surfaced by this work: `SignerConnect.tsx`'s idle-state
text still said "Signing with a temporary local dev key," misleading
now that the local identity can be a real user-imported key — updated
to reference Settings > Identities instead. Deployed via the usual CI
path; confirmed live via a clean `deploy-client.yml` run.

## Known future idea, not started: video/voice calls (2026-08-08)

Prompted by the user asking to research a Nostr+Lightning video-calling
app (HiveTalk, `honey.hivetalk.org`) and whether NOSTRAS could build
something similar. **Research only — no code, no roadmap slot, nothing
scheduled.** Full feasibility writeup lives in
`nostr-client-node-strategy.md`'s "Exploratory: video/voice calls"
section (gitignored, local-only file — see the strategy doc itself for
the complete reasoning, options, and stack-fit analysis).

**The one-line takeaway worth remembering here**: unlike every service
this project has actually shipped (DVMs, zaps, search, NIP-65
aggregation), there is no ratified NIP for WebRTC call signaling — and
even HiveTalk, the most Nostr-forward video app researched, doesn't
attempt Nostr-native signaling. Its actual call engine
(`hivetalksfu`, an AGPL-3.0 fork/collaboration with MiroTalk SFU) is a
conventional Node.js/mediasoup SFU; Nostr is layered on only for login
and Lightning payment. If this is ever picked up, the strategy doc's
recommendation is to follow that same shape (Nostr for identity/NWC,
reusing infrastructure NOSTRAS already has, a dedicated SFU for the
actual media) rather than inventing Nostr-native signaling from
scratch — and to evaluate **LiveKit** (Go + `pion/webrtc`) over
mediasoup specifically because `server/` is otherwise 100% Go and
mediasoup would fork the runtime.

## Silent publish failures fixed in the composer and the NIP-65 editor
(2026-08-08)

Real, user-reported gap, hit twice in the same session in two
different places: a note published through `Composer.tsx` never
actually reached the relay (confirmed via direct `nak` query — no
error shown, the composer just looked like it worked), and separately
a NIP-65 relay-list save via `Nip65RelayListEditor.tsx` got stuck on
"Saving…" indefinitely with no feedback. Both traced to the identical
root cause: **`event.publish(devPublishRelaySet)` called with no
explicit timeout and no `catch`** — the exact same bug class already
found and fixed once before in `useFollowing.ts` ("Follow button
worked inconsistently," logged earlier the same day), just never
applied to these two call sites. A rejected or hung publish became a
silent unhandled promise rejection: no error surfaced, and — in the
composer's case — `setContent('')`/`setAttachments([])` sat *after*
the `await` in the same `try`, so a real failure didn't even clear
stale state to hint that something had gone wrong.

**`Composer.tsx`** gained an explicit `PUBLISH_TIMEOUT_MS = 8000`
(matching `useFollowing.ts`'s own fix) and a real `catch` that sets a
`publishError` state, rendered via the standard `alert-error` class
below the button row (not crammed into the right-aligned `.btn-row`
itself, to avoid overflow on narrow viewports). Content/attachments
now only clear on genuine publish success.

**`useNip65RelayList.ts`** got the identical fix, plus one refinement:
`save()` now returns a real `boolean` (true only on genuine success)
instead of void, because `Nip65RelayListEditor.tsx`'s "Saved."
confirmation needs a synchronous-with-await success signal — reading
the hook's `error` state immediately after `await save(draft)` would
risk a stale closure rather than the value the same call just set.
**`useBookmark.ts` was already flagged as having the identical latent
gap** in the earlier `useFollowing.ts` fix entry and still hasn't been
fixed — noted again here as a real, not-yet-addressed follow-up rather
than expanding scope in this pass.

**Verified for real, not just code review, for both fixes** —
reproducing the actual failure mode rather than trusting the diff:
killed the local relay, confirmed each UI now shows a real error
("Not enough relays received the event...") instead of hanging or
failing silently, with input preserved for retry; restarted the relay
and confirmed both success paths still work, independently verified
against the relay directly via `nak` (not trusted from the UI alone —
the composer's own failure was originally missed by the UI in exactly
this way). `tsc -b`, `oxlint`, `vite build` all clean for both
changes. Deployed via the usual CI path; confirmed live via the
production bundle containing both fixes' error strings and the
deploying commit's SHA.

## Same fix applied to useBookmark.ts, plus a real data-loss risk it
had that the other two didn't (2026-08-08)

Direct follow-up, same session: `useBookmark.ts` had already been
flagged (in the `useFollowing.ts` fix entry) as having "the identical
pattern" — but on closer look it actually had **both** of
`useFollowing`'s original bugs, not just the timeout/error one already
fixed twice above. `toggle()` had no guard against running before the
initial fetch of the existing bookmark list resolved — `listEvent`
starts `null` until that fetch completes, so `existingTags =
listEvent?.tags ?? []` would be `[]`, and since kind:10003 is
replaceable, bookmarking a note before the fetch resolved would have
silently overwritten the user's **entire real bookmark list** with
just the one new entry. Real risk, not hypothetical — the bookmark
button in `EngagementBar.tsx` was only ever `disabled={bookmarkBusy}`,
never gated on fetch-in-flight state.

Fixed both: the same `PUBLISH_TIMEOUT_MS = 8000` + try/catch/error
pattern, plus a `loading` state mirroring `useFollowing.ts`'s own fix,
with `toggle()` refusing to run while `loading`. `EngagementBar.tsx`
now disables the bookmark button on `bookmarkLoading` too, and
surfaces `bookmarkError` via the standard `alert-error` class — forced
onto its own line with a new `.engage-error { flex-basis: 100% }` rule
in the already `flex-wrap` engagement row, so a long error message
doesn't squeeze awkwardly into the compact 8-icon row instead of
wrapping cleanly.

**Verified for real, both fixes together, not separately**: seeded a
throwaway identity's real kind:10003 list via `nak` with one existing
bookmark's `e` tag plus an unrelated legacy tag, confirmed the app's
own bookmark icon correctly rendered that note as already-bookmarked
on load. Killed the local relay and toggled a bookmark on a *second*
note — confirmed a real error appeared ("Not enough relays received
the event...") instead of a hang, and the first note's bookmark state
was untouched. Restarted the relay and toggled the same second note
again — confirmed success, then queried the relay directly via `nak`
(not trusted from the UI icon color alone) and verified the resulting
kind:10003 event preserved the original `e` tag and the unrelated tag
byte-for-byte while correctly appending the new `e` tag — proving the
loading-guard didn't just prevent the crash scenario but that the
underlying tag-preservation logic (already correct before this fix)
still works unchanged. `tsc -b`, `oxlint`, `vite build` all clean.
Deployed via the usual CI path; confirmed live via the production
bundle containing the new error string and the deploying commit's SHA.

**`useBookmark`/`useNip65RelayList`/`useFollowing` now share the
identical fetch-then-republish safety shape** — loading guard, 8s
explicit timeout, try/catch surfaced as a real `error` state, success
only assumed after a genuine resolved publish. Worth using as the
reference pattern for any *future* hook with this same shape, rather
than re-deriving it.

## Per-relay publish result reporting added to the composer (2026-08-09)

Direct follow-up to a real live investigation: the user noticed a note
published through the composer never reached `relay.primal.net` or
`purplepag.es` despite both showing "connected" and toggled on as
session publish targets. Root-caused for real, not guessed: primal.net
turned out to be a user-side toggle miss and damus.io was genuinely
disconnected at the time, but **`purplepag.es` was a real, distinct
finding** — a raw test publish directly to it returned `blocked: kind 1
is not allowed`. It's a metadata-only discovery relay (profiles,
contact lists, relay lists) by explicit policy, not a general note
relay — valuable on a NIP-65 *list* for profile discoverability, useless
as a note *publish target*, and this will never change regardless of
connection state.

Investigating this surfaced a bigger, generally-applicable fact about
this app's whole publish model: **`NDKRelaySet.publish()` only requires
ONE relay to succeed by default** (`requiredRelayCount = 1`) — confirmed
by reading NDK's own source. It still attempts every relay in the set
in parallel and tracks per-relay results internally, but the aggregate
promise only rejects if *fewer than one* relay succeeds. So toggling
several relays as publish targets specifically to widen distribution
had no visibility into partial misses — as long as your own relay (or
any one target) got it, `event.publish()` resolved with zero indication
that other toggled targets were silently skipped.

**Fixed by adding real per-relay result reporting to `Composer.tsx`**,
reusing the exact `relay:published`/`relay:publish:failed` event
pattern `NoteMenu.tsx`'s rebroadcast picker already established
(`NDKRelayPublisher` emits these on the event itself as each relay
resolves, independent of the aggregate promise) — but going one step
further: the failure event's second argument is the actual error, and
this is captured and surfaced as a tooltip on each failed result,
rather than NoteMenu's simpler generic "failed" message. That real
error text is specifically what made the purplepag.es diagnosis
possible in the first place, so it's now visible on every future post
without needing a manual investigation each time. Any relay still
`pending` once the publish settles (never connected in time, no
explicit ack or failure) is swept to `failed` with a `"No response in
time"` fallback message, same safety-net pattern as the rebroadcast
picker.

**Real CSS bug caught during verification, not shipped**: the first
version of `.composer-relay-result-item` was placed earlier in
`App.css` than the base `.relay-result` class it's meant to override
(`width: 16px`, defined for the rebroadcast picker's plain icon-only
usage). Since both rules have equal class-selector specificity, the
later-defined `.relay-result` won the cascade tie — every result item
got squeezed into a 16px-wide box, wrapping its icon+URL text into a
tall, narrow column that visually overlapped the item next to it.
Confirmed via direct DOM inspection (`getBoundingClientRect()` showed
`width: 16, height: 104` on both items) before touching the fix — this
is the exact same cascade-ordering lesson already documented once for
`.view-panel`/`.settings-panel`, now hit a second time in the same
file. Fixed by moving the rule to right after `.relay-result-failed`,
which guarantees it wins any future equal-specificity conflict here
too.

**Verified for real, twice — the feature and the CSS fix together, not
separately**: rather than touch real public relay infrastructure again
(this project's standing precedent from the publish-target-toggle
verification), used the local relay for the success case and a
deliberately nonexistent relay URL
(`wss://nonexistent-test-relay-xyz123.invalid`, added as a real custom
relay and toggled on) for the guaranteed-failure case. First pass
reproduced the actual overlap bug live (confirmed via
`getBoundingClientRect`, not just a screenshot). After the CSS fix,
re-ran the identical test: `✓ ws://localhost:7777` (green) and `✕
nonexistent-test-relay-xyz123.invalid` (red, tooltip "No response in
time") rendered cleanly on one line with no overlap, and the actual
published note was confirmed directly on the local relay via `nak` —
matching content, correct pubkey. `tsc -b`, `oxlint`, `vite build` all
clean. Deployed via the usual CI path; confirmed live via the
production bundle containing the new `composer-relay-result` class and
the deploying commit's SHA.

## Manual "Check for updates" button added to Settings > About
(2026-08-09)

Prompted directly by the user hitting a real stale-tab bug earlier the
same day (a Follow action failed with "Not enough relays received the
event," fixed by a plain reload) and then asking specifically about
installed PWAs: the existing `controllerchange`-triggered reload
(`swUpdate.ts`, from the earlier "stuck blank page" fix) already
handles *applying* an update once one's found, but browsers only
*check* for a new service worker periodically (roughly daily) plus on
fresh navigations — fine for a regular tab, which gets fresh
navigations often just from normal use, but an installed PWA left open
for days can sit on a stale version far longer before that automatic
check even runs.

`client/src/hooks/useServiceWorkerUpdate.ts` is a small hook that calls
`registration.update()` on demand, tracks an `updatefound` listener to
tell "a new version was found and is installing" apart from "nothing
new," and reports one of `unsupported` / `idle` / `checking` /
`updating` / `up-to-date` / `error`. Deliberately does **not** duplicate
the reload logic — once an update is found, `sw.ts`'s own unconditional
`skipWaiting()`+`clientsClaim()` (already established) takes over
within a moment on its own, and the existing global `controllerchange`
listener reloads the page exactly as it already did before this change.
Wired into `AboutSettings.tsx`, next to the existing client-build/relay-
version display, since that's the same "which version am I on" context
and doubles as visible confirmation an update actually changed
something.

**Verified end-to-end against a real service worker, not just built
clean** — `npm run dev` doesn't register one at all (only production
builds do), so this reused the exact `vite preview` + in-place-rebuild
technique already established for the original stuck-tab fix. First
confirmed the "up-to-date" path correctly reports nothing new when
nothing changed. **Then hit the identical dead-code-elimination gotcha
already documented once for `sw.ts` comments, just via a different
mechanism**: the first test change was a plain `const x = '...'; void
x` with no observable side effect, and the bundler silently eliminated
it — confirmed missing from the built `dist/sw.js` via a direct grep
before assuming the feature was broken. Switched to a real
side-effecting `console.log(...)` statement, rebuilt in place, and this
time the change was confirmed present in the built file, detected by
clicking "Check for updates" from the still-open tab, applied, and the
page reloaded cleanly (not stuck) — confirmed by fetching the new
active service worker's own script afterward and verifying the marker
was actually there, not just that *a* reload happened. Test change
fully reverted before finishing (`git diff` on `sw.ts` clean). `tsc -b`,
`oxlint`, `vite build` all clean. Deployed via the usual CI path;
confirmed live via the production bundle containing the button's text
and the deploying commit's SHA.

## A 4th DVM job kind: spam/scam classification, server-side piece
shipped (2026-08-09)

Real research → real scoping → real server-side shipping, all the same
day. Prompted by "what real Nostr user pain could an AI prompt actually
solve" — real web research (not brainstormed) found spam/scam content
is the most consistently cited Nostr-specific complaint, and confirmed
by reading the actual current NIP-90 job kind registry directly that no
existing kind covers trust/safety classification. Full research write-
up and the concrete build plan live in `nostr-client-node-strategy.md`
(gitignored, local-only — see there for the sourced research, the
kind-number reasoning, and the on-demand-vs-automatic scoping decision
that's still deliberately unresolved).

**Job kind `5501` → `6501`**, chosen adjacent to the community-
registered `5500` "Malware Scanning" kind — a safety/trust judgment,
not a content-discovery job, so it doesn't belong in the `53xx`
discovery cluster it was first (and wrongly) grouped with during
scoping. `server/cmd/dvm/main.go` gained this as a 4th job type
alongside summarize/translate/Ask Claude, reusing every existing
mechanism unchanged: the generic `i`-tag request parsing, payment
gating, dynamic per-token pricing (`estimateJobCostSats`), and the
NIP-89 handler announcement (now lists `5501` alongside the other
three). The only genuinely new code is the constant pair, one
`handleJob` switch case, and a system prompt (`moderateSystemPrompt`)
— `callClaude` itself needed no changes.

**Response format is a deliberately lightweight convention**, not a
new Claude API feature this DVM hasn't used before: line 1 a strict
single-line JSON object (`{"verdict":"spam"|"scam"|"legit",
"confidence":"low"|"medium"|"high"}`), line 2+ a one-sentence
human-readable reason. A future client can try to parse line 1 for a
badge and always has the reason text as a fallback if parsing fails —
degrades gracefully rather than hard-failing.

**Verified for real, twice — locally and in production, not just built
clean**. Locally: ran the DVM against a real Claude API call in free
mode, deliberately without touching `nostras.env` or any real wallet —
passed a syntactically-plausible but unreachable NWC URI as a
process-only environment variable (the app's own existing
graceful-degrade-to-free-mode behavior handled the rest). Published
two real jobs directly via `nak`: a genuine crypto-scam note (`"send
0.001 BTC... get 1 BTC back instantly"`) correctly came back
`{"verdict":"scam","confidence":"high"}` with an accurate one-sentence
reason, and a genuine benign personal note (a hike anecdote) correctly
came back `{"verdict":"legit","confidence":"high"}` — confirming the
prompt actually discriminates rather than defaulting to one verdict.
Confirmed the NIP-89 announcement listed `5501` with the updated About
text. `go build`/`go vet`/`gofmt -l` all clean.

Deployed via the usual CI path (clean run, no false-negative this
time). **Re-verified live in production** rather than trusting the
local pass alone: published a real `kind:5501` job against
`wss://nostras.app` for a genuine fake-giveaway scam text and got back
a real `payment-required` feedback event with a valid invoice (not
paid, standing rule) — confirms the new kind is correctly dispatched
end-to-end in the payment-gated production path, not just the local
free-mode one. Queried the live NIP-89 announcement by the DVM's
*current* pubkey specifically (a first query without `-a` returned a
stale announcement from an old, since-redeployed DVM identity — kind
`31990` is only replaceable per-author, so old identities' announcements
persist indefinitely; this is expected, not a bug) and confirmed it
correctly lists `5501` with the updated About text.

**Deliberately not yet done**: the client-side consumer UI (a "Check
this note" button, scoped in the strategy doc as structurally simpler
than `TranslateButton` — no picker step). The DVM job itself is live
and payable by any NIP-90-aware client today regardless; NOSTRAS
becoming its own consumer is a separate, not-yet-started piece.

## Client-side piece shipped: "Check for spam/scam" in NoteMenu
(2026-08-09)

Direct follow-up, same day: the client half of the 5501->6501
classification DVM. Wired into `NoteMenu.tsx` (the "..." dropdown)
rather than the main `EngagementBar` icon row — a less-frequently-
needed action, matching how Rebroadcast/Report/raw-event already live
in that menu, not the primary row. Structurally simpler than
`TranslateButton.tsx`: no picker step, since there's no parameter to
choose — clicking the menu item fires `requestDvmJob` (from
`lib/dvm.ts`, reused completely unchanged) directly.

**Only re-fires on an explicit "Check again" inside the done/error
view, not on every reopen of the menu item** — matches this
component's existing idempotent-guard convention (report/mute/delete
already work this way), specifically so reopening the panel can't
accidentally trigger a second *paid* job. The menu item itself shows
"Checked ✓" once a check has run, and reopening it shows the existing
result instantly rather than re-checking.

**Parses the DVM's lightweight two-line convention** (a strict JSON
verdict line, then a human-readable reason — see the server-side entry
above) into a real color-coded badge: `scam` uses `--danger`/
`--danger-bg`, `spam` uses `--accent`/`--accent-bg`, `legit` uses a
border-only `--success` treatment since **no `--success-bg` token
exists in the design system** — deliberately not inventing a new rgba
value the rest of the app doesn't share. A malformed or missing JSON
line falls back to showing the raw content as plain text rather than
hard-failing, matching the DVM's own graceful-degrade posture.

**Verified end-to-end against a real Claude API call, in a real
browser, not just built clean**: same free-mode local DVM setup as the
server-side verification. Seeded a genuine scam note (a fake-giveaway/
advance-fee-fraud text) directly on the local relay via `nak`, found it
through NOSTRAS's own Search (NIP-50, confirms the full real path — not
a synthetic test harness), opened its menu, clicked "Check for
spam/scam…", and confirmed a real `SCAM · HIGH CONFIDENCE` badge
rendered with an accurate, specific reason. Clicked "Check again" and
confirmed a genuinely fresh, independent Claude call ran (slightly
different phrasing in the reason, same correct verdict) rather than
replaying a cached result. Closed and reopened the menu and confirmed
"Checked ✓" showed correctly and reopening instantly displayed the
existing result with no re-fire. `tsc -b`, `oxlint`, `vite build` all
clean. Deployed via the usual CI path; confirmed live via the
production bundle containing the button's text and the deploying
commit's SHA.

**Both pieces of the on-demand spam/scam classification DVM are now
fully shipped** — server (kind `5501`->`6501`, live and payable by any
NIP-90-aware client) and NOSTRAS's own client consumer. The automatic/
feed-filtering mode discussed in the strategy doc's scoping remains
explicitly out of scope — a separate values-level decision, not a
natural next step from this.

## Wrong follow state + hanging profile feed — a third occurrence of the
"unscoped authors-filtered NDK query races real-time relay connection
state" bug class (2026-08-09)

User-reported, live, with a screenshot: a second real identity
(SOVEREIGN_CITIZENS) opened MMOnostr's profile from a fresh Firefox
session and saw three wrong things at once — the Follow button read
"Follow" despite SC having already followed MMOnostr from a different
client, MMOnostr's own "Following" stat read 0, and the notes list
never left its loading skeleton.

**Root cause, confirmed with real data, not assumed**: `useFollowing.ts`
and `useFollowCounts.ts` both called `ndk.fetchEvent({kinds:[3],
authors:[pubkey]})` with no explicit relay set, and `useNoteFeed.ts`
called `ndk.subscribe({kinds:[1,30023], authors, limit:50})` the same
way. Read NDK's own installed source to confirm the mechanism: an
authors-filtered query with no relay set routes through
`calculateRelaySetsFromFilter`, which — before the outbox tracker has
resolved an author's real NIP-65 write relays — falls back to
`pool.permanentAndConnectedRelays()`, filtered to relays already at
`status >= CONNECTED` **at the exact moment the query starts**. This
races real-time connection state: a one-shot `fetchEvent` (used by both
hooks, `closeOnEose: true`) can resolve the instant its *initial*,
possibly single-relay set reports EOSE — before a slower-to-connect
relay carrying a newer copy of the same replaceable event ever joins
the query, and a promise that's already resolved can't be corrected by
`refreshRelayConnections()` picking up that relay later. Confirmed this
was real, not theoretical, by querying SC's actual kind:3 directly
across relays: the copy on `wss://nostras.app` (2026-08-06) predates SC
actually following MMOnostr, while a genuinely newer copy — with
MMOnostr's pubkey present — exists on `relay.damus.io` (2026-08-07,
published from a different client). Cross-checked independently via a
live browser test: MMOnostr's real "Following" count is **578**, not
the **0** SC's session showed.

This is the third occurrence of a bug class already documented once
before (the NIP-23 deeplink naddr-redirect fix, 2026-08-08): *any*
authors-filtered NDK query with no explicit relay set is a candidate,
not just the one call site fixed there.

**Fixed the same proven way**: all three hooks now pass `localRelaySet`
explicitly (`ndk.fetchEvent(filter, undefined, localRelaySet)` /
`ndk.subscribe(filter, {relaySet: localRelaySet})`), so the query goes
to exactly one already-connected relay instead of racing a
client-computed set. This loses no real capability — `server/outbox.go`
already fans out to an author's true write relays for any
authors-filtered query the *relay* receives, bounded by its own proven
timeout + concurrency cap, so cross-relay discovery still happens
server-side. `useFollowCounts.ts`'s *followers* subscribe
(`{kinds:[3], '#p':[pubkey]}`) was deliberately left unscoped — it
filters on `#p`, not `authors`, so NDK never routes it through the
CONNECTED-only fallback in the first place; it already queries the full
explicit relay list unconditionally and was never subject to this race.
Likewise `useNoteFeed.ts`'s global feed (no `authors`) is unaffected for
the same reason.

**Verified for real, not just from static analysis**: rebuilt locally
with `VITE_RELAY_URL=wss://nostras.app` (pointed at real production
data, not local dev's empty store) and reloaded MMOnostr's profile in a
live browser with the fix in place — correctly showed **578 Following,
6 Followers**, and the notes list rendered immediately with no hang.
**Not independently re-verified for the exact SC-specific Follow-button
path** — that requires SC's own real signer, which this project never
touches (see the standing key-custody rule) — so that specific half
rests on the shared root-cause fix plus the corroborating Following-
count evidence, not a literal replay of SC's own session. `tsc -b`,
`oxlint`, `vite build` all clean. Deployed via the usual CI path;
confirmed live via the production bundle containing the deploying
commit's SHA (`d00a7b4`).

## Search could hang on "Searching…" forever, no error, no way out
(2026-08-09)

Direct follow-up: asked SC to reload and confirm the follow-state fix
above, and got back a screenshot of a genuinely new, separate symptom —
the search box stuck on "Searching…" indefinitely after pasting
MMOnostr's npub, never resolving.

**Real bug, independent of the fix above**: `SearchView.tsx`'s content
search calls `ndk.fetchEvents()` (plural) with no timeout at all.
Confirmed by reading NDK's own source: unlike `ndk.fetchEvent()`
(singular — used by `useFollowing`/`useFollowCounts`/the deeplink
resolver), which has a hard internal 10s `setTimeout` fallback,
`fetchEvents()` has none whatsoever — it only ever resolves via the
queried relay's `onEose` callback. If that relay connection never
completes for any reason (a network hiccup, a slow handshake, the
relay itself briefly unreachable), the promise never settles, `state`
stays `'loading'` forever, and the UI gives zero feedback — no error,
no retry affordance, nothing. This is a real robustness gap that
existed independent of anything about SC's specific session; the
npub-detection fast path (`resolvePubkeyInput` → `viewProfile()`,
which never touches this code at all) is unaffected — this only hits
the content-search fallback branch.

**Fixed** by wrapping the `fetchEvents()` call in the same
`withTimeout()` helper pattern already established in
`lib/remoteSigner.ts` (10s), added directly in `SearchView.tsx` rather
than extracting a shared utility for one additional call site. On
timeout, `state` flips to `'error'` and the existing
"Search failed — is the local relay running?" message renders — the
same error path that already existed for a genuine fetch rejection,
now also reachable from a timeout instead of an infinite hang.

**Verified by reproducing the actual failure mode, not just reasoning
about the code**: ran a local dev build with `VITE_RELAY_URL` pointed
at a deliberately unreachable hostname (so `localRelaySet` — what
`SearchView` queries — resolves to a relay that can never connect),
confirmed the exact same stuck-"Searching…"-forever symptom live in a
browser, then confirmed after the fix that it correctly un-stuck at
the 10s mark with the real error message instead of hanging. `tsc -b`,
`oxlint`, `vite build` all clean. Deployed via the usual CI path;
confirmed live via the production bundle containing both the deploying
commit's SHA (`dc9c0a0`) and the literal string `"Search timed out"`.

**Still open**: whether this timeout fix is what SC was actually
hitting (a real relay hiccup on their end) or whether their search was
additionally affected by something session-specific (e.g. leftover
text in the input field scrolled out of view — hit accidentally once
by Claude earlier in this same investigation from reusing a
non-empty field) hasn't been distinguished. Either way, the "stuck
forever with zero feedback" failure mode is now closed regardless of
which cause triggered it for SC specifically — worth having them
retry with a freshly cleared field now that a hang can no longer
persist past 10 seconds.

## External profiles too slow — the localRelaySet fix from the day
before traded correctness for speed (2026-08-10)

Direct follow-up: asked SC to reload and confirm the follow-state fix,
got back a screenshot of a *different* real profile (Derek Ross, not a
NOSTRAS user) with "Unfollow" correctly showing this time (the original
fix working) but "Following: —" stuck and the notes list still stuck
in its loading skeleton — reported plainly as "very bad" user
experience.

**Root cause: the previous day's fix was correct but incomplete.**
Scoping `useFollowing`/`useFollowCounts`/`useNoteFeed` to `localRelaySet`
alone (2026-08-09) killed the real staleness/wrong-answer race, but it
also meant *every* authors-filtered query — for any profile that isn't
a NOSTRAS user, so has nothing on our own relay directly — now depended
entirely on our relay's own server-side outbox fetch
(`server/outbox.go`, bounded but still up to ~10s: an 8s fetch timeout
plus up to a 2s semaphore wait), with no parallel path anymore. Before
that fix, the old unscoped client-side query could (when it worked)
pull from whichever of the local/damus/primal relays connected first —
often fast, just unreliable. The fix removed the unreliability and the
speed together.

**Fixed by adding `authorQueryRelaySet`** (`lib/ndk.ts`) — local relay +
the two public bootstrap relays, explicit — used by all three hooks
instead of `localRelaySet`. This is not a reversion to the original bug:
passing an *explicit* relay set makes NDK actively connect every relay
in it via `pool.useTemporaryRelay()` regardless of prior connection
status, unlike the original unscoped case, which only ever used whatever
happened to already be `CONNECTED` at query time — that gap (not
multi-relay querying itself) was the actual race. Confirmed by reading
NDK's own `NDKSubscription.eoseReceived` logic: once ≥2 of the queried
relays have reported EOSE, it applies a short converging timeout instead
of waiting on every relay — so a well-known external user already
indexed on the public relays resolves almost immediately from them,
while our own relay's slower outbox fetch still runs in parallel as a
correctness backstop for anyone it's the only source for.

**Found and fixed the same issue one layer deeper while verifying this**:
`useProfile.ts` (the profile name/avatar/bio cache used everywhere,
not just `ProfileView`) calls `NDKUser.fetchProfile()`, which internally
runs the identical unscoped `ndk.fetchEvent({kinds:[0], authors:[pubkey]})`
— same bug class, one call NDK ships itself rather than code in this
repo. `fetchProfile()`'s options type doesn't document a `relaySet`
field, but reading NDK's source confirmed it spreads `opts` into its
internal `subscribeOpts` before checking the (here-unused) third
positional relay-set argument — so `fetchProfile({relaySet:
authorQueryRelaySet})` genuinely takes effect, verified by outcome, not
assumed from the type signature alone. **Also found and fixed a real,
separate latent bug while adding this**: the original code had no
`.catch()` on the fetch promise — a rejection would have left that
pubkey stuck in the in-flight set forever, silently blocking any retry
for the rest of the session. Neither of these needed the day-before's
bug to exist; both were always there.

**Verified for real, not just from reasoning about NDK's source**:
temporarily added debug logging to trace exact fetch timing, then hit a
real methodology mistake worth recording honestly — a browser-automation
mixup (DOM state not re-checked between coordinate-based actions) meant
an early test run was actually checking a random unrelated profile, not
Derek Ross, and looked stuck when it was just a different, genuinely
unfindable pubkey. Caught this by checking the rendered npub against the
one actually searched for, not assumed from screenshots alone. Redid the
test driving the search through direct DOM manipulation (setting the
input's value via its native setter, dispatching a real `input` event,
clicking the actual Search button) rather than coordinate clicks, and
confirmed against Derek Ross's real pubkey specifically: `following`
correctly resolved to 1307 (matching his real count), 21 real notes
rendered, and his real name/avatar resolved (through a single confirmed
local case that took ~14s under a synthetic worst case — many other
profile fetches racing for the same relays at once, from a busy Global
feed's ~90 other avatars all live-fetching simultaneously; not the
scenario SC actually reported, whose screenshot already showed the name/
avatar resolved correctly, only Following/notes stuck). Debug logging
removed before shipping. `tsc -b`, `oxlint`, `vite build` all clean.
Deployed via the usual CI path; confirmed live via the production bundle
containing the deploying commit's SHA (`a69d5bb`).

**Honest state as of this entry**: the two symptoms SC's actual
screenshot showed (Following stuck at "—", notes stuck loading) are
fixed and verified against real production data for a real external
identity. The one thing not independently re-confirmed from SC's own
browser specifically (same standing limitation as the follow-button fix
the day before — this project doesn't touch other people's signers) is
whether their exact session now loads within a UX-acceptable window;
worth having them reload once more to confirm.

## Continuous reload loop — the SW update guard was in-memory, reset on
every reload it triggered (2026-08-10)

Direct follow-up: asked SC to reload and confirm the profile-speed fix.
First screenshot looked genuinely good — "Unfollow" correct, real name/
avatar/banner, notes beginning to render. A few seconds later, a second
screenshot showed the same profile back in its loading skeleton, and
SC described it as looking like "a continuous loop for reloading."

**Root cause, found by reading the one piece of code in this codebase
that ever calls `location.reload()`**: `swUpdate.ts`'s reload-on-
`controllerchange` guard (added 2026-08-06 to fix the original "stuck
blank tab" bug) was a plain in-memory `let reloaded = false`. But
`window.location.reload()` tears down the entire JS context — so that
variable resets to `false` on the very page load it just triggered.
This session shipped **four** client deploys in fairly quick succession
(the search-timeout fix, the follow-state fix, the profile-speed fix,
plus the spam/scam button the day before). A tab left open across that
window would legitimately have a *new* service worker to chase after
each one — and since the guard couldn't remember it had *already* just
reloaded for this reason, it reloaded again for the next version, and
again for the one after that. Each individual reload was "correct" in
isolation; in rapid succession it reads exactly like an infinite loop
to whoever's staring at the screen, which is exactly what was reported.

**Fixed** by moving the guard from an in-memory flag to a `sessionStorage`
timestamp with a 15s cooldown — `sessionStorage` survives
`location.reload()` (cleared only when the tab actually closes), so a
second `controllerchange` arriving within that window is suppressed
instead of triggering another immediate reload. This is a debounce, not
a permanent lock: a trigger after the cooldown elapses still reloads
normally, so the tab still converges on the latest version, it just
doesn't visibly thrash through every intermediate one.

**Verified two ways, not just reasoned about**: (1) the exact guard
logic, copied verbatim into a live browser console rather than
re-derived, confirmed three rapid triggers reload only on the first and
suppress the next two, and confirmed a trigger after the cooldown
window elapses still reloads — precise and deterministic, sidestepping
the fact that real service-worker activation timing isn't something
this remote tooling can control to sub-15-second precision over several
separate tool round-trips. (2) A real end-to-end run (the same
`vite preview` + in-place-rebuild technique as the original stuck-tab
fix) confirmed the `sessionStorage` timestamp genuinely persists across
an actual triggered reload of a real page, not just in theory. `tsc -b`,
`oxlint`, `vite build` all clean; the temporary sw.ts test markers used
during verification were fully reverted (`git diff` clean) before
committing. Deployed via the usual CI path; confirmed live via the
production bundle containing both the deploying commit's SHA (`c5464de`)
and the new `sessionStorage` guard key.

**Not yet independently reconfirmed from SC's own browser** — same
standing limitation as every fix in this thread, this project doesn't
touch other people's signers or sessions. No further client deploys are
planned right now, so the specific rapid-succession trigger that caused
this shouldn't recur even without the fix — but the fix closes the
underlying gap regardless of deploy cadence going forward.

## Bookmarks silently disappearing — a full codebase audit found two more
instances of the unscoped-authors-filter bug class (2026-08-10)

Real user report: bookmarks the user had definitely set before were
gone — "No bookmarks yet." Correctly guessed by the user that this
might be a browser-storage issue and asked directly; the real answer
is no — bookmarks are a real NIP-51 kind:10003 event stored on the
relay, never in browser storage, so a cache clear can't touch them.

**Root cause: the same bug already fixed four times this session,
just never audited for every remaining instance.** `BookmarksView.tsx`
called `ndk.fetchEvent({kinds:[10003], authors:[pubkey]})` with no
relay set — same unscoped-authors-filter race as
useFollowing/useFollowCounts/useNoteFeed/useProfile. Confirmed against
real production data before fixing: this user's actual bookmark list
(9 real bookmarked notes) lives **only** on `wss://nostras.app`, not on
either public bootstrap relay — so if that one relay hadn't yet reached
`CONNECTED` status at the exact moment the unscoped query fired (e.g.
switching to the Bookmarks tab quickly after a fresh page load), the
computed relay set could exclude it entirely and the query would
resolve genuinely empty, not stale — matching the reported symptom
exactly.

**Grepped the entire client codebase for every remaining
`ndk.fetchEvent`/`ndk.subscribe`/`ndk.fetchEvents` call** rather than
assuming the four already-fixed call sites were the only ones, and
classified each one:
- **Safe, no change needed**: anything tag-filtered (`#e`/`#p`) rather
  than `authors`-filtered — `useDirectMessages.ts`, `useNotifications.ts`,
  `useZapTotal.ts`, `useEventCount.ts`, `useFollowCounts.ts`'s own
  followers subscribe, `lib/dvm.ts` — none of these route through NDK's
  CONNECTED-only fallback in the first place, confirmed by the same
  source-level reasoning already used for the original fix. Also safe:
  `useReferencedNote.ts` (an id-only lookup, no authors filter) and
  `BookmarksView.tsx`'s own second fetch (`fetchEvents({ids})`, also
  id-only) — the latter deliberately stays unscoped, matching its
  documented intent that a bookmarked note "can be anywhere," not just
  the local relay.
- **Already correctly scoped**: `lib/deeplink.ts` (fixed 2026-08-08, the
  original instance of this bug class) and `lib/nwc.ts` (its
  authors-filtered wallet-response subscribe already takes an explicit
  relay set as a 3rd argument).
- **Found genuinely vulnerable, not yet fixed**: `NoteMenu.tsx`'s
  `handleMute` (`kind:10000`, authors-filtered — same
  replaceable-event data-loss risk already fixed once for
  `useFollowing`: publishing from a falsely-empty mute list would wipe
  the real one) and `lib/dm.ts`'s `discoverRecipientDmRelays`
  (`kind:10050`/`kind:10002`, authors-filtered — a race here would
  silently fall back to local-only DM delivery, the exact failure mode
  that function exists to prevent).

**Fixed all three the same way**: scoped to `authorQueryRelaySet`
instead of left unscoped, identical to the four prior fixes. `tsc -b`,
`oxlint`, `vite build` all clean. Deployed via the usual CI path;
confirmed live via the production bundle containing the deploying
commit's SHA (`b357837`).

**Not independently re-verified against the user's own live session**
for the bookmarks fix specifically (same standing limitation as every
fix in this thread) — but the mechanism is the same one already proven
correct via live testing against real external-identity data earlier
this session, and the real-data placement check above (bookmarks
existing only on our own relay) directly explains the reported symptom
rather than leaving it a coincidence.

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
  shares the relay's dependencies. Offers four job kinds per the NIP-90
  kind registry (see `github.com/nbd-wtf/go-nostr/nip90` for the full
  catalog): text summarization (`5001`->`6001`), translation
  (`5002`->`6002`), free-form text generation / Ask Claude
  (`5050`->`6050`), and spam/scam classification (`5501`->`6501`,
  chosen adjacent to the community-registered `5500` "Malware
  Scanning" kind — see the dated entry for the full research/scoping
  behind it). Listens on the local relay only. Uses the real Claude API
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
