---
name: build-in-public
description: Use when the user asks how to grow NOSTRAS or their own presence around it ("how do I grow my business", "what should I post", "draft me the next thing"), or references the week-by-week content plan. Complements /grow (real usage signals — DVM jobs, followers, PR/Geyser status) and /distribute (getting listed somewhere) — this one owns content cadence specifically: what to post next, drafted honestly from the real shipped history in docs/history/, never published without sign-off.
---

# Building NOSTRAS in public

`/grow` answers "how are the real numbers doing." `/distribute` answers
"is this listed/funded anywhere." Neither one answers "what should I
actually post today" — that's this skill's one job. Deliberately
narrow, same spirit as the other two: draft honestly, log what
happened, never publish without explicit sign-off.

## 1. Read the Content log first

Check `nostr-client-node-strategy.md`'s **Content log** section
(create it near the Growth log if it doesn't exist yet — same
gitignored, local-only file). It tracks what's already been drafted,
what actually got published (with the real event id, not just "I think
it went out" — verify against the relay directly the same way every
other check in this project does), and which stories from docs/history/
have already been used so they don't get recycled.

**The plan is a menu and a rough sequence, not a rigid calendar.** If
the user posted on day 1 and nothing since day 10, don't robotically
hand them "day 11's assigned task" — reorient from what's actually
logged, the same honesty `/grow` already applies to numbers. A gap is
a fact to report, not a deadline to pretend was hit.

**The seed plan**, agreed with the user on 2026-08-08:
- **Week 0**: nothing to chase on distribution (submissions too fresh)
  — just get a first post out.
- **Week 1**: one real "building in public" note sourced from the
  `docs/history/` log; short notes every other day after (a fix, a screenshot, a
  number); 10–15 min/day genuinely engaging — replying, zapping — in
  Bitcoin/Nostr dev circles, not broadcasting. This is the
  highest-leverage-per-minute lever at low follower counts.
- **Week 2**: one real NIP-23 long-form article (NOSTRAS renders these
  natively), handed directly to a small number of specific real people
  who'd plausibly care — quality over reach, not a mass blast.
- **Week 3**: an explicit, low-stakes usage invite ("try Ask Claude for
  21 sats, tell me what breaks") — usage is a stronger trust signal
  than a follow. Recheck pending distribution submissions.
- **Week 4**: re-run `/grow`'s real signal check, compare deltas
  (completed DVM jobs from genuinely new pubkeys, followers, PR/Geyser
  status), keep what moved a number and drop what didn't.

## 2. Draft the next piece, sourced honestly

Same sourcing discipline as `/distribute` step 3 and `/grow` step 4:
pull from the dated, actually-shipped, actually-verified entries in
`docs/history/` (one file per month; `CLAUDE.md` itself is now only the
short guide) — never the strategy doc's aspirational sections, never
inflated. Real incidents with an honest complication or a
self-correction in them (see the khatru broadcast-path post — the
"first attempt made it worse" detail) read as far more credible in
this audience than a clean highlight reel. Match content to where the
Content log says we are:

- **Short note**: a fix, a real number, a screenshot. Cheap, frequent.
- **Long-form article** (kind 30023): one real incident with a genuine
  narrative arc — root cause, what was tried, what didn't work, what
  actually fixed it. Draft via the Compose > Article tab.
- **Usage invite**: low-stakes, specific ("try X for N sats"), not a
  generic call to action. **Default the link to `https://nostras.app/tools`
  (2026-09-16, direct user instruction, same reasoning as `/engage`'s
  own step 4 update the same day)** whenever the invite is about a DVM/
  AI job (translate, summarize, spam-check, ask) — it's a real, lower-
  friction ask than "switch clients," confirmed live to work from any
  Nostr client, not just NOSTRAS. Link the app root instead only when
  the invite is genuinely about the client itself (a UI feature, an
  onboarding flow) — same "which real thing does this citation serve"
  judgment call as `/engage`'s, not a blanket replacement.
- **A code-snippet image**, if it adds real information (actual current
  code pulled fresh from the repo, not recreated from memory) rather
  than decoration — see the khatru post for the pattern: a local HTML
  card, rendered and screenshotted, matching NOSTRAS's own brand
  gradient. Skip images that would just be decorative; this audience
  reads stock/generic imagery on a technical post as diluting it, not
  strengthening it.

## 3. Never publish without explicit sign-off

Drafting is free. Presenting the exact text (and image, if any) and
waiting for explicit confirmation before it goes anywhere is not
optional, regardless of how similar a prior approved post was — same
standing rule as `/distribute` and `/grow`. The actual publish click,
and any signer approval it needs, is the user's own action.

## 4. Log the outcome

After a real posting decision (drafted, posted, or explicitly skipped),
append a dated entry to the Content log: what it was, whether it went
out, and — if published — the real event id or a link, confirmed
against the relay directly rather than trusted from the UI alone (this
project has hit silent publish failures before; verifying for real is
cheap and has already caught a real bug once). This is what makes the
next `/build-in-public` ask actually pick up from real state instead of
re-deriving it.

## 5. Be honest about what this can't do

Same limitation `/grow` already names: this can systematize drafting
and honest logging, but it cannot manufacture engagement, cannot
substitute for the user actually showing up to reply/zap other people
(the plan's own Week 1 reciprocity item — this skill can remind, not
do it for them), and cannot turn a quiet week into content that isn't
there. If nothing genuinely new shipped since the last post, say so
plainly rather than stretching a small update into a bigger one than
it is.
