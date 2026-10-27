---
name: distribute
description: Use when the user wants to get NOSTRAS listed, submitted, discovered, or funded somewhere outside this repo — directory sites (nostr.net, nostrapps.com), NIP-89 app handler events, crowdfunding/funding platforms (Geyser), app-store-adjacent listings, or similar. Also use when the user asks to check on distribution status generally — surface every channel in the ledger, not just the one most recently discussed. Tracks what's already been done so the same channel isn't submitted to twice, and keeps submissions honest about which features are actually shipped.
---

# Distributing NOSTRAS

A repeatable process for getting NOSTRAS in front of people outside this
repo — directory listings, protocol-native discovery (NIP-89), funding
platforms, and anything similar. Each of these is a small, one-off
action, but they share the same shape and the same failure modes, so
follow this rather than re-deriving the process each time.

## 1. Check what's already been done

Before proposing or drafting anything, read
`nostr-client-node-strategy.md`'s **Decisions log** (search for "First
concrete distribution action," "Second distribution action," "Third
distribution action," and similar dated entries — nostr.net,
nostrapps.com, and Geyser as of this writing) and its **PWA
distribution** section under "Post-roadmap: polish, hosting,
distribution." This is the running ledger of every channel considered,
decided, submitted, and its current status. Don't re-submit somewhere
already listed; don't re-propose a channel already explicitly declined.

**When the user asks to check on "distribution" generally** (not one
specific channel by name), check every entry in the ledger, not just
whichever one came up most recently in conversation — the whole point
of logging each one is so a status check surfaces all of them together.
Status checks look different per channel, since they aren't all the
same shape:
- **GitHub PR** (nostr.net) — `gh pr view <number> --repo <owner>/<repo>`
- **NIP-34 git-over-nostr PR** (nostrapps.com) — reload the PR's
  `gitworkshop.dev` page live, don't trust a cached view
- **Crowdfunding campaign** (Geyser) — reload the project's own launch/
  status page live; status here isn't just open/merged/closed, it's a
  review state (pending/live/rejected) that later becomes an ongoing
  contribution total once live, so "check status" means both "did it
  get approved" and, once live, "how's it doing"
- **nostrhub.io listing** (kind:31990, author `0da1a169…`,
  `d=2vr3lgb0`) — nostrhub publishes only to its own relays,
  `relay.ditto.pub` and `relay.dreamith.to`. Check that the newest
  revision there is also on nos.lol, relay.damus.io, relay.primal.net
  and nostras.app (`nak req -k 31990 -a <pubkey> -t d=2vr3lgb0
  wss://<relay>`). **After every edit on nostrhub** it won't be, so
  NIP-89-aware clients reading the big relays keep the old version or
  none. Fix: fetch the newest event from relay.ditto.pub, check it with
  `nak verify`, and with the user's sign-off send it unchanged with
  `python3 -I .claude/skills/distribute/rebroadcast.py event.json
  wss://nos.lol wss://relay.damus.io wss://relay.primal.net
  wss://nostras.app`. Never use `nak event` for this: it re-signs its
  input. Read the event back from each relay (damus often 503s; retry).
  First done 2026-10-27.

If `nostr-client-node-strategy.md` doesn't exist in this checkout (it's
gitignored, local-only), say so and ask the user for context instead of
assuming a blank slate.

## 2. Research the target's actual submission format

Never guess a directory's listing format from memory or from what
similar sites look like. Fetch the real contribution guidelines
(CONTRIBUTING.md, README, or the site's own "how to add yours" page) and
match its exact conventions — bullet format, required fields, category
placement, star badges, alphabetical ordering, whatever it actually
uses. Getting this wrong wastes a maintainer's review cycle. (Precedent:
the nostr.net listing pulled the real format directly from
`aljazceru/awesome-nostr`'s README before drafting anything.)

## 3. Draft honestly, from the actual feature history

Source claims from the dated entries in `docs/history/` (one file per month) — what's genuinely
shipped and verified — not from the strategy doc's aspirational roadmap
sections. A listing that oversells gets caught by exactly the audience
it's trying to reach.

**Lead with `https://nostras.app/tools`, not just the app root, where
the target format allows a second link (2026-09-16, direct user
instruction — same reasoning as `/engage` and `/build-in-public`'s own
updates the same day)**: a directory visitor's lowest-friction real
action is trying one DVM job, not installing a new Nostr client — `/tools`
works from any client, confirmed live. Keep the main app link too
(`/tools` doesn't replace it, most directories expect the actual
product URL as primary) — add `/tools` alongside it as the "try it
without switching clients" option wherever the submission format has
room for one, per the target's own real conventions from step 2.

## 4. Get explicit sign-off before anything goes public

Drafting is free; submitting is not. Present the draft (exact text,
where it goes, what account/identity it'll be submitted under) and wait
for explicit confirmation before opening a PR, filling a form, or
publishing anything — regardless of how similar a prior approved action
was. This matches the project's standing rule that public-facing actions
need per-action confirmation, not a standing blanket approval.

When the target site attributes contributions to an individual (e.g. a
GitHub PR), prefer submitting from the user's own account/fork rather
than a generic identity, unless they say otherwise — it's their project
and their name that should be attached. Same principle for a "who's
behind this" / social-proof field on a funding platform: link the
identity actually accountable for the project, not whichever available
identity has the most followers or reach — a funding page misrepresenting
who's asking for money is a real integrity problem, not just a
suboptimal choice.

**Funding platforms specifically involve real money and real payment
destinations** — this is a step further than a plain listing. Drafting
the pitch/story/goal text is fine to do end-to-end; entering real
payment-receiving details (a Lightning address, an on-chain address,
connecting a payment processor) is the user's own action and their own
real wallet/account, never something to fill in on their behalf or
suggest a specific existing address for without them confirming it's
the one they want publicly attached to this campaign.

## 5. Log the outcome back to the ledger

After submitting (or after the user reports a status change — merged,
rejected, needs changes, moved from review to live, a contribution
milestone), update `nostr-client-node-strategy.md`'s Decisions log
entry for that channel: what was submitted, the actual PR/listing/
project URL, and current status. Follow the existing Choice/Why/Status
format used elsewhere in that log. This is what makes the next
session's step 1 actually work — an undocumented submission is as good
as one that never happened.
