---
name: engage
description: Use when the user wants to spend real engagement time on Nostr — replying to and zapping other people's notes — and wants it targeted at genuinely relevant, substantive discussions instead of random liking/zapping. Checks for replies to past engagement first, then surfaces real new threads worth engaging with, helps draft honest replies grounded in the user's actual expertise, and logs what happened. Complements /build-in-public (owns content cadence — what to post) and /grow (tracks the resulting follower/signal deltas) — this one owns the reciprocity half of the growth plan specifically: real engagement, never scripted or generic.
---

# Engaging on Nostr, on purpose

The growth plan's Week 1 reciprocity item ("10–15 min/day replying,
zapping — not broadcasting") has been logged as "not yet started" at
every `/grow` check so far. The reason is obvious in hindsight: nothing
made it easy to find the *right* things to engage with, so it never
happened. This skill's one job is closing that gap — not more posting,
not automation, just making the user's own limited engagement time land
on threads that actually matter.

## 1. Check for replies to your own past engagement first

Added 2026-08-16, directly prompted by the user asking whether a future
session would ever notice if someone replied back — until this step
existed, the honest answer was no: every prior run only looked forward
for new threads, so a real conversation could die after one reply and
nothing would surface that.

Before searching for anything new, pull every **full** reply event id
you've personally replied to from the Engagement log's own dated
entries below (each session's "Posted and verified" paragraph should
name the confirmed reply event id in full, not just the target note's
`nevent`) — currently a couple dozen total, cheap enough to re-check in
full every session rather than needing separate state-tracking of
what's "already been checked."

**Real limitation, checked directly rather than assumed (2026-08-16):
every session before the tenth logged a *truncated* reply id**
(`9702afd78...`-style, first ~10 hex chars only) — a real relay `#e`
tag filter needs the exact full 64-char id, so none of sessions 1-9 can
actually be checked by this step as things stand; only the tenth
session onward is mechanically checkable. Not backfilled — re-deriving
nine sessions' worth of full ids from truncated prefixes was judged out
of scope for adding this step, not worth doing speculatively. Step 8
below now requires the **full** id going forward specifically so this
gap stops growing; treat any session still logging a truncated id as a
mistake to fix, not an accepted format.

For each full id you have, query public relays
(`{"kinds":[1], "#e":["<reply-id>"]}` on `wss://relay.damus.io`,
`wss://relay.primal.net`, `wss://nos.lol`) and keep anything authored
by someone other than the user's own pubkey — a genuine reply-to-your-
reply, not your own threading. A quick `{"kinds":[7,9735],
"#e":["<reply-id>"]}` pass is worth adding too, matching this skill's
own existing "a reply, a follow, a zap in return" language in step 8 —
a like or zap back is a real, lighter-weight signal worth logging even
when it doesn't warrant a drafted follow-up.

**Extraction caveat, real not hypothetical (2026-09-02)**: don't rely on
a single fixed phrase (e.g. grepping for the word "reply" near a hex
id) to pull ids out of past sessions' write-ups — wording has genuinely
varied (`reply: `id``, `Question → `id``, and likely others not yet
hit), and a grep keyed to one phrasing silently misses ids logged under
another. Scan for every 64-char hex id under a session's own "posted
and verified" heading regardless of the surrounding words, or — more
reliable than parsing prose at all — just do the pre-draft check added
to step 3 below for every fresh candidate, which catches an already-
replied-to note directly from the relay rather than depending on this
doc's own text staying perfectly parseable.

Apply the same substance filter as step 3 below — **including the
known-spam-account check**, not just "is this low-effort": the very
first real run of this step (2026-08-16, same day it was added) turned
up a "reply" within minutes from `7949809730b8...`, part of the exact
invinoveritas/Agent One templated-pitch network this log has flagged
and skipped across sessions 3/4/5/9/10 for auto-replying to unrelated
notes — this time the templated pitch showed up as a reply-to-a-reply
instead of a reply-to-an-original-note, same bot, same non-sequitur
content, not a genuine reaction. Cross-check any hit here against
already-known noise accounts the same way step 3 does for fresh
threads, don't treat "it replied" alone as a real signal. A real
follow-up question or genuine pushback deserves a drafted reply through
the same sign-off process as anything else in this skill; a bare
"thanks" or a generic emoji reaction doesn't need one — log it as a
reaction, don't manufacture a reply just to have one. If nothing in the
whole
previously-engaged set has a new reaction since it was last checked,
say so plainly and move on to step 2 — a quiet week for replies-to-
replies is a real, expected outcome most of the time, not a sign
anything's broken.

**Cross-platform distribution posts (2026-08-23)**: `/distribute`'s own
Decisions log is where live announcement posts outside Nostr get
recorded (Stacker News, r/nostr, and whatever comes after) — check
there too, not just this skill's own Engagement log, for any post with
its own reply surface worth following up on. Three real, distinct cases
from the first Stacker News + r/nostr announcement, each handled
differently:

- **A Stacker News "crosspost to nostr" note is a genuine kind:1
  event** — check it exactly like any other tracked reply id
  (`{"kinds":[1,7,9735], "#e":["<crosspost-id>"]}`), no special handling
  needed. First real instance: `35e20d39c107ce3b3b6cb3e17cbe34c7ce88fb98af6f5e54a6561f4220bda4c6`
  (landed on `nostrue.com`/`relay.damus.io`/`relay.nostr.band`/
  `relay.snort.social`/`relay.primal.net` — Stacker News' own default
  relay set, not this skill's usual three).
- **Stacker News' native comment thread** (separate from the Nostr
  crosspost) isn't reachable via relay queries, but Stacker News has a
  real, working, unauthenticated public GraphQL API — confirmed live:
  `curl -s https://stacker.news/api/graphql -X POST -H "Content-Type:
  application/json" -d '{"query":"{ item(id: \"<item-id>\") { title
  ncomments sats } }"}'` returns genuine data (verified against item
  `1553166`, the real NOSTRAS post). Comment *content* is reachable too
  (a real `comments` field exists on the schema — confirmed via a
  GraphQL validation error naming the type, not a wall — worth a quick
  introspection query to get the exact field names before relying on
  this, not guessed here).
- **Reddit is confirmed unreachable, not just unattempted**: both
  `WebFetch` (explicit tool-level refusal for `www.reddit.com`) and a
  direct `curl` with a real browser user-agent (Reddit's own edge
  returns a hard "Blocked" page either way) fail. No automated path
  exists from this environment — ask the user to check and report back,
  or paste a screenshot, rather than claim this is checkable the same
  way as the other two.

## 2. Find genuinely relevant threads, not just anything trending

The app's own search (`SearchView.tsx`, NIP-50) is scoped to the local
relay only and isn't built for this — it won't surface broad public
discourse. Query public relays directly instead, using `nak`, for
recent notes matching topics the user has real standing to speak on:
Nostr protocol/NIP discussion, Lightning/NWC payment rails, relay
operation (khatru, badger, Go), NIP-90 DVMs, agent-to-agent payments,
Blossom media hosting — the actual subject matter of NOSTRAS and the
user's own adjacent work (`llmops-pro`, `nostr-merchant`). Use `#t`
hashtag-tag filters (`#nostr`, `#nostrdev`, `#asknostr`, `#lightning`,
`#bitcoin`, `#nip90`, `#dvm`, `#nwc`, `#relay`, `#mcp`, `#agents`,
`#blossom`) within a 48h `--since` window (not just `--limit` — see
step 2's own methodology note below), then read the actual content —
don't just count matches.

**Query the app's own `CURATED_RELAYS` list** (`client/src/lib/
curatedRelays.ts` — the 15-relay list already vetted for NOSTRAS's
Rebroadcast picker), minus `purplepag.es` (a metadata-only relay that
structurally rejects kind:1 queries, so it never has anything to find
here). Real, user-prompted fix (2026-08-21): every session before this
one queried only 2-3 relays (`relay.primal.net`/`nos.lol`, sometimes
`relay.damus.io`), which the user correctly flagged as too narrow given
how much real traffic NOSTRAS's own unfiltered Global feed shows moving
every minute. Verified directly before adopting this, not assumed: a
test `#asknostr` query against the full list found real notes on
`nostr.wine`/`relay.snort.social`/`nostr21.com`/`offchain.pub`/
`nostr.mom`/`nostr.oxtr.dev` that the original 2-3-relay set alone
would have missed entirely. **Honest caveat, also confirmed by that
same test**: several of the 15 (`relay.nostr.band`, `eden.nostr.land`,
`relay.nostr.bg`, `relay.current.fyi`, `relayable.org`) were
unreachable at test time — query all of them every run, but don't
expect every one to answer; that's normal relay-availability churn, not
a sign the list is wrong.

## 3. Filter for substance

Skip engagement bait, low-effort "gm" posts, and anything that reads as
spam (this project already has a real spam/scam classifier — the DVM's
own kind:5501 job — worth running against a borderline note if unsure,
consistent with dogfooding NOSTRAS's own tooling). Look for genuine
questions, real technical disagreements, or discussions where the user
has something specific and true to add — not just "relevant keywords,"
actually worth a reply. A handful of real candidates beats a long list
of shallow matches.

Real, live example worth remembering (2026-08-16): the user flagged an
account replying to *hundreds* of unrelated threads per minute with
templated, keyword-triggered responses — including replying to overtly
racist content with an unrelated stock-volume stat — purely to farm
follower growth. That's the failure mode this whole skill exists to
avoid: volume over judgment. A handful of genuinely substantive replies
a day is the point, not a limitation to work around.

**Before drafting, check whether we've already replied to this exact
note** — a real, distinct check from step 1's own past-reply-reaction
check, which only covers reactions *to* replies already logged there.
Real gap found live (2026-09-02): a fresh candidate found in step 2
(a Bark/Ark zap question) turned out to already have a real MMO reply
from an earlier session — logged, but under a differently-worded line
("Bark/Ark zap question → `id`") that step 1's own id-extraction grep
(keyed to the literal word "reply" appearing near the id) didn't match,
so it went undetected and a second, largely redundant reply got sent.
Query `{"kinds":[1], "#e":["<candidate-note-id>"], "authors":
["<operator-pubkey>"]}` against the same three relays step 1 already
uses, for every candidate, right before drafting — cheap (one query per
candidate, not per historical id) and catches this regardless of how
any earlier session happened to phrase its own write-up.

## 4. Draft honest, specific replies — never generic

No "nice post!", no emoji-only reactions, nothing that could have been
written without reading the note. Ground every draft in the user's
actual experience and this project's real, shipped history (same
sourcing discipline as `/build-in-public` — pull from `CLAUDE.md`'s
dated entries when a reply calls for "here's how we hit that exact
problem," not from the strategy doc's aspirational sections). Never
invent a stance, credential, or experience the user doesn't actually
have.

## 5. Flag it plainly when a linked post only renders correctly in NOSTRAS

Real gap found live (2026-08-14): a zap goal (kind:9041, NIP-75) opened
in Yakihonne didn't render at all, and a paid article's NIP-44-encrypted
content showed as raw ciphertext with no unlock UI — both expected,
both correct behavior for those other clients (an unrecognized event
kind should be safely ignored, not crash or show garbage), but both
genuinely broken experiences for a reader who doesn't happen to be on
NOSTRAS.

Any note this skill drafts or replies with that links to a zap goal, a
paid article, or any other NOSTRAS-specific feature not backed by a
widely-adopted NIP should say plainly that it's best viewed in NOSTRAS
— don't let a reader open a link expecting it to just work in whatever
client they're already using. A short, honest line is enough ("renders
correctly in NOSTRAS — app.nostras.app"), not an apology or a sales
pitch. This is about setting the right expectation, not talking anyone
into switching clients.

## 6. Zap amounts, if any, should be proportionate and real

Small, typical-for-Nostr amounts (a genuine mid-two-digit-to-low-
hundreds sats range is the usual social norm here, not a fixed rule) —
this is appreciation, not a transaction. Same standing project rule as
everywhere else: Claude builds/shows the option, the user's own wallet
action sends it. Never assume a zap is wanted; ask.

## 7. Never send anything without explicit sign-off

Same discipline as every other skill here. Present the exact reply
text (and the target note, and the account it'll post from) and wait
for explicit confirmation before anything gets published. Drafting
several candidates for the user to pick from, edit, or reject outright
is the point — this is about spending *their* limited time well, not
replacing their judgment. Applies equally to a fresh-thread reply
(step 4) and a follow-up to a reaction found in step 1 — neither ever
gets sent unconfirmed.

**Include each target note's `nevent` (bech32, with relay hints via
`nak encode nevent -a <pubkey> --relay <url> --relay <url> <id>`) right
alongside its draft in this same first presentation** — real friction
found live (2026-08-21): every prior session made the user ask a
separate follow-up message just to get these, purely because step 7
never said to include them up front. The user needs the `nevent` to
actually locate and send the reply themselves (from NOSTRAS's own
search or any other client) — there's no reason to make that a second
round trip.

## 8. Log the session

Append a dated entry to `nostr-client-node-strategy.md`'s **Engagement
log** section (create it if it doesn't exist yet, near the Content and
Growth logs) — which past-engagement reactions were found (step 1),
which new threads were surfaced, which were engaged with (replied/
zapped/skipped) and why, and any real reaction that came back (a reply,
a follow, a zap in return). Name the confirmed reply event id **in
full** (64 hex chars, not truncated) explicitly in the "posted and
verified" write-up, not just the target note's `nevent` — step 1 of the
*next* session can only query for replies against the exact id, and a
truncated one silently can't be checked (see step 1's own note on why
sessions 1-9 already have this gap). This is what lets `/grow` report a
real reciprocity
signal instead of "still hasn't started," and lets the next `/engage`
session pick up from real state instead of re-surfacing the same
threads.

## 9. Be honest about what this can't do

This can make engagement time more targeted and can draft better
replies faster. It cannot manufacture relationships, cannot guarantee
a reply gets seen or reciprocated, and cannot substitute for the user
actually reading the thread and meaning what gets sent. If a session
turns up nothing genuinely worth engaging with — no new reactions in
step 1, nothing substantive in step 2 — say so plainly. A quiet day in
the relevant discourse is a real observation, not a reason to lower the
bar just to have something to post.
