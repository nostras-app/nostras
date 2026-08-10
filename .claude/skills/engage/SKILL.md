---
name: engage
description: Use when the user wants to spend real engagement time on Nostr — replying to and zapping other people's notes — and wants it targeted at genuinely relevant, substantive discussions instead of random liking/zapping. Surfaces real threads worth engaging with, helps draft honest replies grounded in the user's actual expertise, and logs what happened. Complements /build-in-public (owns content cadence — what to post) and /grow (tracks the resulting follower/signal deltas) — this one owns the reciprocity half of the growth plan specifically: real engagement, never scripted or generic.
---

# Engaging on Nostr, on purpose

The growth plan's Week 1 reciprocity item ("10–15 min/day replying,
zapping — not broadcasting") has been logged as "not yet started" at
every `/grow` check so far. The reason is obvious in hindsight: nothing
made it easy to find the *right* things to engage with, so it never
happened. This skill's one job is closing that gap — not more posting,
not automation, just making the user's own limited engagement time land
on threads that actually matter.

## 1. Find genuinely relevant threads, not just anything trending

The app's own search (`SearchView.tsx`, NIP-50) is scoped to the local
relay only and isn't built for this — it won't surface broad public
discourse. Query public relays directly instead
(`wss://relay.damus.io`, `wss://relay.primal.net`, `wss://nos.lol`, and
similar), using `nak`, for recent notes matching topics the user has
real standing to speak on: Nostr protocol/NIP discussion, Lightning/
NWC payment rails, relay operation (khatru, badger, Go), NIP-90 DVMs,
agent-to-agent payments — the actual subject matter of NOSTRAS and the
user's own adjacent work (`llmops-pro`, `nostr-merchant`). Use `#t`
hashtag-tag filters (`#nostr`, `#nostrdev`, `#asknostr`, `#lightning`,
`#bitcoin`) and pull a recent window, then read the actual content —
don't just count matches.

## 2. Filter for substance

Skip engagement bait, low-effort "gm" posts, and anything that reads as
spam (this project already has a real spam/scam classifier — the DVM's
own kind:5501 job — worth running against a borderline note if unsure,
consistent with dogfooding NOSTRAS's own tooling). Look for genuine
questions, real technical disagreements, or discussions where the user
has something specific and true to add — not just "relevant keywords,"
actually worth a reply. A handful of real candidates beats a long list
of shallow matches.

## 3. Draft honest, specific replies — never generic

No "nice post!", no emoji-only reactions, nothing that could have been
written without reading the note. Ground every draft in the user's
actual experience and this project's real, shipped history (same
sourcing discipline as `/build-in-public` — pull from `CLAUDE.md`'s
dated entries when a reply calls for "here's how we hit that exact
problem," not from the strategy doc's aspirational sections). Never
invent a stance, credential, or experience the user doesn't actually
have.

## 4. Zap amounts, if any, should be proportionate and real

Small, typical-for-Nostr amounts (a genuine mid-two-digit-to-low-
hundreds sats range is the usual social norm here, not a fixed rule) —
this is appreciation, not a transaction. Same standing project rule as
everywhere else: Claude builds/shows the option, the user's own wallet
action sends it. Never assume a zap is wanted; ask.

## 5. Never send anything without explicit sign-off

Same discipline as every other skill here. Present the exact reply
text (and the target note, and the account it'll post from) and wait
for explicit confirmation before anything gets published. Drafting
several candidates for the user to pick from, edit, or reject outright
is the point — this is about spending *their* limited time well, not
replacing their judgment.

## 6. Log the session

Append a dated entry to `nostr-client-node-strategy.md`'s **Engagement
log** section (create it if it doesn't exist yet, near the Content and
Growth logs) — which threads were surfaced, which were engaged with
(replied/zapped/skipped) and why, and any real reaction that came back
(a reply, a follow, a zap in return). This is what lets `/grow` report
a real reciprocity signal instead of "still hasn't started," and lets
the next `/engage` session pick up from real state instead of
re-surfacing the same threads.

## 7. Be honest about what this can't do

This can make engagement time more targeted and can draft better
replies faster. It cannot manufacture relationships, cannot guarantee
a reply gets seen or reciprocated, and cannot substitute for the user
actually reading the thread and meaning what gets sent. If a session
turns up nothing genuinely worth engaging with, say so — a quiet day
in the relevant discourse is a real observation, not a reason to
lower the bar just to have something to post.
