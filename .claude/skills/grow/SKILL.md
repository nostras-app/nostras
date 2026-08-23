---
name: grow
description: Use when checking on NOSTRAS's real growth/traction ("how is NOSTRAS doing", "are we growing"), or when a genuine usage/funding milestone might be worth announcing. Complements /distribute (which tracks getting listed/discovered somewhere) by tracking what happens after — real usage over time — using actual protocol/relay data, not vanity metrics like npub follower counts.
---

# Growing NOSTRAS

Distribution (`/distribute`) gets NOSTRAS listed and discovered.
Growth is what happens after — does real usage actually increase over
time. This skill is scoped deliberately narrow: it systematizes the
mechanical, repeatable parts (checking real signals, logging them so
the next check can show a real delta, flagging genuine milestones) and
is explicit about what it can't do — see the last section.

**Don't benchmark against unrelated accounts.** A personal npub with
200K followers built over years is not a meaningful comparison point
for a young protocol project's own account. The numbers that actually
matter here are usage signals — job volume, real connections, funding
progress — not follower counts.

## 1. Check real signals, not vanity metrics

- **DVM job volume** — the most meaningful usage signal this project
  has, since every result is a real settled or attempted job, not a
  passive view. Find the DVM's current pubkey from its own NIP-89
  announcement rather than hardcoding it (identities can be
  regenerated on redeploy): `nak req -k 31990 -t d=nostras-dvm
  wss://nostras.app`. Then count real results:
  `nak req -k 6001,6002,6050 -a <dvm-pubkey> wss://nostras.app`.
- **GitHub activity** — `gh api repos/nostras-app/nostras` for
  stars/watchers. This is the docs-only public org; the source repo
  stays private by design, so this is the only public repo signal that
  exists to check.
- **Distribution channel status** — defer to `/distribute` rather than
  re-deriving it; don't duplicate that skill's own status-check logic
  here.
- **Geyser funding progress** — once the project is out of review,
  check the live project page for real contribution totals.
- **Follower count for the project's real identity** — lowest-priority
  signal, and honestly scoped: a plain relay query for kind:3 events
  tagging the identity's pubkey only reflects what's visible on the
  relays queried, not the whole network (same caveat `useFollowCounts.ts`
  documents client-side). Useful as one data point, not the headline
  number.
- **Distribution post engagement** (added 2026-08-23, after the first
  Stacker News + r/nostr announcement) — a real signal category
  `/distribute`'s own PR/listing-status checks don't cover, since a
  live post can keep accumulating engagement long after the submission
  itself is "done." Check the Decisions log for any live announcement
  post, then: **Stacker News** has a real, unauthenticated public
  GraphQL API — `curl -s https://stacker.news/api/graphql -X POST -H
  "Content-Type: application/json" -d '{"query":"{ item(id:
  \"<item-id>\") { ncomments sats } }"}'` returns genuine comment/sats
  counts, confirmed live against the real NOSTRAS post (item `1553166`).
  The **Nostr crosspost note** (if the post used Stacker News'
  "crosspost to nostr" option) is a genuine kind:1 event, countable the
  same way as any other tracked note via `nak req -k 1,7,9735 -e
  <crosspost-id>`. **Reddit is not checkable this way** — confirmed
  blocked at the network level (both `WebFetch` and a direct `curl`
  with a browser user-agent get refused by Reddit's own edge) — ask the
  user to report real upvote/comment numbers rather than claim a
  number this skill can't actually verify.

## 2. Log each check as a dated snapshot

Append a dated entry to `nostr-client-node-strategy.md` under a
**Growth log** section (create it if it doesn't exist yet, near the
Decisions log) with the real numbers from step 1. The point of logging
every check, not just milestones, is so the *next* check can report a
real delta ("DVM jobs: 47 → 62, +15 since the last check") instead of
just a snapshot with no trend. An unlogged check is as useless here as
an undocumented distribution submission is in that skill.

## 3. Flag genuine milestones, don't manufacture hype

A milestone is something that actually happened, not a round number
picked for its own sake. Real examples: a distribution channel going
live (a PR merges, a funding review approves), a first real
contribution or first real payment from a stranger, a job-count
threshold that's genuinely notable given the project's actual scale so
far. If nothing genuine happened since the last check, say so plainly
— "no real milestone this check" is a fine, honest outcome, not a
failure to find something to announce.

## 4. When a milestone is real, draft an honest announcement — never post it without sign-off

Same discipline as `/distribute` step 3: source every claim from
`CLAUDE.md`'s actually-shipped, actually-verified feature history, not
aspirational framing. Same discipline as `/distribute` step 4: drafting
is free, publishing anywhere (a Nostr note, the Telegram group, a
follow-up on an existing channel) needs the user's explicit sign-off
per action, regardless of how similar a prior approved post was.

## 5. Be honest about what this can't do

This skill can systematize checking and honest reporting. It cannot
manufacture organic growth, cannot substitute for the user actually
being a known, trusted person in the Nostr/Bitcoin community over time,
and cannot turn a quiet week into a milestone that didn't happen. If a
check comes back flat, report that plainly rather than reaching for
something to spin — the same honesty this project has applied to every
feature verification applies here too.
