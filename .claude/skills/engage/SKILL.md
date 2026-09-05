---
name: engage
description: Use when the user wants to spend real engagement time on Nostr — replying to and zapping other people's notes — and wants it targeted at genuinely relevant, substantive discussions instead of random liking/zapping. Checks for replies to past engagement first, then surfaces real new threads worth engaging with — prioritizing genuine technical questions the user can answer with real precision, per real zap-receipt evidence (2026-09-05) that this specific archetype, especially language-matched and naming something concrete, is what actually converts into reciprocity — helps draft honest replies grounded in the user's actual expertise, and logs what happened. Complements /build-in-public (owns content cadence — what to post) and /grow (tracks the resulting follower/signal deltas) — this one owns the reciprocity half of the growth plan specifically: real engagement, never scripted or generic, aiming for more of it in both volume and hit rate without lowering the substance bar.
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
`wss://relay.primal.net`, `wss://nos.lol`, **and `wss://nostras.app`
— see the real 2026-09-05 miss below for why this one isn't
optional**) and keep anything authored by someone other than the
user's own pubkey — a genuine reply-to-your-reply, not your own
threading. A quick `{"kinds":[7,9735],
"#e":["<reply-id>"]}` pass is worth adding too, matching this skill's
own existing "a reply, a follow, a zap in return" language in step 8 —
a like or zap back is a real, lighter-weight signal worth logging even
when it doesn't warrant a drafted follow-up.

**When a real zap comes back on one of these, decode it, don't just
count it (2026-09-05)** — a kind:9735 receipt's own `description` tag
holds the original signed zap request, which has the sender's real
pubkey, the amount, and any comment; the receipt's `e` tag names which
of your replies earned it. This is exactly how the archetype in step 3
was found in the first place, and it's cheap to redo every session:
knowing that a *specific* reply (language-matched, or naming a
concrete detail) earned a real zap — versus a reply that didn't — is
the actual feedback signal for whether step 3/4's guidance is working,
not just a nice thing to log. Note it explicitly in step 8's write-up
when it happens.

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
a sign the list is wrong. A single 503/timeout on one relay
(`relay.damus.io` has done this repeatedly) is worth one retry a few
seconds later before writing that relay off for the session — a real
zap receipt was once missed entirely this way (see the archetype
write-up in step 3) purely because the relay it lived on happened to
be down on the first attempt.

**Widening search for more real opportunities, not a lower bar
(2026-09-05)**: the user explicitly asked for more engagement, in both
quantity and quality, after seeing real zap evidence (see step 3) that
direct technical-question threads are what actually convert. The
right way to get *more* of those is to search harder for the same
narrow, high-value category — not to relax which threads qualify.
Concretely: add question-shaped hashtags this list didn't originally
prioritize (`#nip42`, `#nip90`, `#nostrdev`, `#help`, `#asknostr` — the
existing set already had some of these, worth treating as the primary
targets now rather than one category among many), widen the `--since`
window when a run comes up thin (72h instead of 48h is a reasonable
second pass, not a standing default), and query in more than one
language when scanning — a Spanish-language technical question is
exactly the shape that produced this project's single largest real zap
(see step 3) and a hashtag-only/English-keyword search can miss it
entirely. Running this skill more often (daily rather than sporadically)
compounds the same way any search does — more passes over a live feed
surface more real candidates — and is a real lever for "more quantity"
that doesn't touch the substance bar at all.

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

**The highest-value archetype, confirmed by real zap data, not a
guess (2026-09-05)**: the user asked directly why three specific real
zaps landed in the last 5 days, and the answer was traceable and
concrete for two of the three. Both real, organic zaps (not the third
— see below) were reactions to a **direct reply answering a specific
technical question about NIP-42 relay authentication** — not a
broadcast post, not general commentary. **LL62 zapped 100 sats** for a
clear, precise English answer (what NIP-42 auth actually proves,
why NOSTRAS defaults it on). **ErDuende zapped 500 sats** — this
project's single largest real zap to date — for the *same* explanation
delivered in Spanish, the asker's own language, with one added,
concrete detail: a real bug the user had actually hit in NDK's own
NIP-42 helper (`NDKRelayAuthPolicies.signIn` hanging silently), named
specifically rather than described generically. The third zap in that
same window (10 sats, from an account posting what read as a
self-promotional plug for its own project rather than a reaction to
anything the user wrote) did **not** fit this pattern — a small
zap attached to unrelated promotional content is a different, lower-
signal category, not evidence the archetype below is wrong.

**What this means concretely for finding and drafting threads**:
1. **Prioritize genuine questions over general discussion.** A post
   asking "why does X happen" or "how do I do Y" that the user can
   answer with real, specific, correct technical knowledge is worth
   more than an on-topic but opinion-only thread — rank these first
   when a session turns up several candidates.
2. **Reply in the asker's own language when it isn't English.** Don't
   translate a canned English answer — write the actual reply in that
   language, the way the ErDuende case did. This is a real, evidenced
   multiplier, not a nice-to-have.
3. **Name something concrete and specific, not a generic explanation.**
   A real bug encountered, an exact NIP number, a specific measured
   number, a real file/component name — anything checkable and true,
   per this project's own established sourcing discipline (see step 4)
   — is what separated the 500-sat reply from the 100-sat one answering
   the identical underlying question.
This doesn't change what already-drafted guidance said (see step 4) —
it's the same "ground every draft in the user's actual experience,
never generic" rule this skill already had, now backed by real,
falsifiable evidence for *which* substantive replies actually convert
into reciprocity, not just goodwill.

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

**Always include `wss://nostras.app` in this specific query, not just
the three public relays (2026-09-05)** — a real, live near-miss: a
pre-draft check queried `relay.damus.io` (down at the time) +
`relay.primal.net` + `nos.lol` and came back empty for a note that
already had a real reply, only findable because it happened to also
live on `nostras.app`. The user caught it before sending, not this
check. One dead relay in a 3-relay list is enough to miss a real reply
if the other two don't happen to carry it — `nostras.app` is this
project's own relay and a likely landing spot for its own replies, so
it belongs in this query by default, not as a fallback tried only
after a miss.

## 4. Draft honest, specific replies — never generic

No "nice post!", no emoji-only reactions, nothing that could have been
written without reading the note. Ground every draft in the user's
actual experience and this project's real, shipped history (same
sourcing discipline as `/build-in-public` — pull from `CLAUDE.md`'s
dated entries when a reply calls for "here's how we hit that exact
problem," not from the strategy doc's aspirational sections). Never
invent a stance, credential, or experience the user doesn't actually
have.

**Match the asker's own language.** If the original note is written in
Spanish, French, or anything else, draft the reply in that language —
not a translated-after-the-fact English answer. See step 3's archetype
write-up for the real, evidenced case (a Spanish-language reply earned
this project's largest real zap to date, replying to the same question
an English reply had already answered for someone else at a fifth the
amount). Only fall back to English if genuinely unsure of fluency in
the target language — a real, correct answer in imperfect language
beats a fluent non-answer.

**When the note is a real technical question, name something checkable
and specific in the answer** — a real bug hit, an exact NIP number, a
file or component name, a real measured number — not just a correct-
but-generic explanation. Both are honest; only the specific one is what
the real zap evidence in step 3 shows actually converts.

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

**When a reply matched the archetype in step 3** (a real technical
question, answered in the asker's own language and/or naming something
concrete), say so explicitly in the write-up even before knowing
whether it earned a zap — this is what lets a future session count how
often the high-value pattern was actually attempted, not just how many
replies went out total. Quantity and quality are both being tracked
here on purpose, per the user's own explicit ask (2026-09-05): more
sessions, more candidates found per session, and a rising share of them
matching the confirmed archetype — not just a bigger raw reply count.

## 9. Be honest about what this can't do

This can make engagement time more targeted and can draft better
replies faster. It cannot manufacture relationships, cannot guarantee
a reply gets seen or reciprocated, and cannot substitute for the user
actually reading the thread and meaning what gets sent. If a session
turns up nothing genuinely worth engaging with — no new reactions in
step 1, nothing substantive in step 2 — say so plainly. A quiet day in
the relevant discourse is a real observation, not a reason to lower the
bar just to have something to post.

**The step 3 archetype is a real, evidenced pattern, not a
guarantee.** Two zaps is a real signal worth building process around —
it is not a large enough sample to promise that every language-matched,
specific technical reply earns a zap, or that zaps will scale linearly
with how many such replies go out. Chasing "more engagement" (the
user's own explicit 2026-09-05 request) means searching harder and more
often for genuine technical questions this user can answer well — it
does not mean answering more questions superficially, and it does not
mean the reward is guaranteed even when the technique is followed
exactly. Report real outcomes each session, including a session where
the pattern was followed correctly and nothing came back — that's
still useful information, not a failure to hide.
