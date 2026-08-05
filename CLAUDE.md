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
