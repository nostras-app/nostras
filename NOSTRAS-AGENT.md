# NOSTRAS Agents

Two distinct things live under this name, deliberately kept separate —
different identities, different infrastructure, different trust models:

1. **NOSTRAS Desktop Agent** — live, running today. Your own private,
   local, DM-only Claude Code, scoped to this repo, that only you can
   talk to.
2. **Nostras Agent** — a concept, not yet built. A public, autonomous,
   Fly-hosted Nostr identity whose job is business development: explain
   itself honestly, engage with the Nostr community where genuinely
   relevant, and be the top-of-funnel for a larger "bring your own agent
   to Nostr" service.

---

# 1. NOSTRAS Desktop Agent — DM your own Claude Code, over Nostr

A local daemon (`agent/`) that lets you task Claude Code on this exact
repo by sending it real Nostr DMs — from your phone, from anywhere —
using your own real NOSTRAS identity as the remote control. It runs
permanently on this desktop machine, not on any public infrastructure.
Full build history, design decisions, and two real bugs found and fixed
during live verification are documented in `CLAUDE.md`'s "nostr-agent"
entry; the original implementation plan lived at
`/home/user/.claude/plans/crystalline-puzzling-gosling.md`.

**Agent npub**: `npub1ecxp4qddstny2mj5cdlxdaf3y56kvlgr24kscs2jx7tf6hjxr6kq3nzvag`

DM that npub from your own NOSTRAS session (as MMO) to talk to it.

## How it works

1. **Its own identity.** The agent has a dedicated Nostr keypair,
   generated once and persisted locally in `agent/agent.env` (gitignored
   — never committed, never shared with the client's own identity or the
   DVM's). It publishes a normal kind:0 profile and a kind:10050 DM relay
   list, so your NOSTRAS client's existing "find where to send a DM"
   logic works exactly like it does for any other person.

2. **Listens for DMs, verifies it's really you.** It subscribes to
   NIP-17 gift-wrapped DMs (kind:1059) addressed to its own pubkey on
   `wss://nostras.app`, `wss://relay.damus.io`, and `wss://relay.primal.net`.
   Every incoming message gets decrypted and its real sender checked
   against your real pubkey — **only messages genuinely from your own
   identity are ever acted on.** Anyone else's message (a stranger who
   discovers the agent's npub) is silently decrypted, recognized as not
   you, and dropped — no reply, no action, nothing logged anywhere
   public.

3. **Dispatches your message to headless Claude Code, in this repo.**
   Once a message is verified as yours, the daemon runs
   `claude -p` against this exact directory (`/home/user/Documents-LENOVO/LLMOps.Pro/NOSTR/NOSTRAS`)
   — the same CLAUDE.md, the same skills, the same memory, the same
   tools (Bash, Edit, Read, Write, git) you already get in an interactive
   session here. **It runs with full autonomy** — no permission prompts,
   nothing pauses to ask you first — a deliberate choice made when this
   was built, so think of a DM to the agent the same way you'd think of
   handing someone your keyboard and saying "go do this," not a
   suggestion it'll check with you before acting on.

4. **Remembers the conversation.** Each reply keeps the same Claude Code
   session alive (`--resume`), so a follow-up DM continues the same
   conversation with full context — it's one ongoing chat, not a fresh
   amnesiac session every message. This persists across a daemon
   restart too (the session id is saved to disk), so a crash or reboot
   doesn't lose the thread.

5. **Replies back to you over DM**, gift-wrapped the same way, sent to
   wherever your own NOSTRAS client actually reads DMs.

## What you can ask it — real capabilities

Because it's running full, unrestricted Claude Code against this actual
repository, the honest answer is: **almost anything you'd ask me to do
in a normal session here.** Concretely, across the three categories you
asked about:

**Coding tasks** — yes, the full range:
- "What's the current git status / what changed in the last commit?"
- "Fix the bug where X does Y" — it can read code, edit files, run
  `tsc -b`/`oxlint`/`go build`, and commit if you ask it to (see the
  autonomy warning below — it *will* commit and even push without
  asking first if you tell it to).
- "Check if the DVM is still healthy" / "check the relay's memory usage"
- "Deploy the latest changes to production" — this is a real,
  consequential capability worth being explicit about: with full
  autonomy and `git`/`gh` access, it genuinely can push and trigger a
  real Fly deploy if you ask it to. Only ask for this when you actually
  mean it.

**Skill execution** — yes. Every skill in `.claude/skills/` (`health-check`,
`engage`, `distribute`, `grow`, `build-in-public`) is available to it
exactly as it is to me, since it's running in this same project
directory. "Run the health-check skill" or "run /engage" work as DMs.

**Nostr-protocol-native tasks** — yes, and this is where it gets genuinely
interesting given what it already has access to:
- It can shell out to `nak` (installed on this machine) to query relays,
  publish test events, inspect real kind:X events, verify a fix landed
  on production — the same way I do throughout this project's own
  history.
- It can read and reason about this project's entire NIP-by-NIP
  implementation (`nostras-nips-compliance.md`, `CLAUDE.md`) and extend
  it — e.g. "implement NIP-X" is a completely reasonable DM.
- It shares this project's accumulated memory
  (`/home/user/.claude/projects/-home-user-Documents-NOSTR/memory/`), so
  it isn't starting cold on context about you, the project's history, or
  standing preferences — the same memory this interactive session uses.

**What it will *not* do, as a hard invariant regardless of full
autonomy**: send, initiate, or construct a real Lightning payment,
through any code path — enforced three separate ways (a system-prompt
rule, a `PreToolUse` hook that denies payment-shaped Bash commands
outright, and the daemon's own process never even holding the real NWC
wallet connection string). Everything else this project's standing
CLAUDE.md rules already govern (secrets hygiene, git safety, etc.) still
applies the same way it does in any of my own sessions here — full
autonomy means no permission *prompts*, not that the underlying project
rules stop applying.

**Practical limits worth knowing**: a 10-minute wall-clock timeout per
message (a very long task may get cut off — ask it to keep going in a
follow-up DM if so), a $5 cost ceiling per message (a real safety valve,
not a soft target — the first message in a while can cost over a dollar
on its own just from re-warming Claude's prompt cache on this repo's
large CLAUDE.md, which is expected, not a bug), and it's scoped to this
one repository only — it can't act on other projects on this machine.

## Restarting after a crash or reboot

The daemon does **not** currently auto-start on boot or auto-restart on
a crash — it's a plain, manually-started process. If this machine
restarts, or the process dies for any reason, your DMs will simply sit
unanswered on the relay until you start it again — nothing is lost
(messages aren't missed once it's back up, and the conversation resumes
via the saved session id), but nothing happens automatically either.

To check whether it's running:
```sh
cd /home/user/Documents-LENOVO/LLMOps.Pro/NOSTR/NOSTRAS/agent
[ -f state/agent.pid ] && ps -p "$(cat state/agent.pid)" > /dev/null 2>&1 \
  && echo "running, pid $(cat state/agent.pid)" || echo "not running"
```

To start (or restart) it:
```sh
cd /home/user/Documents-LENOVO/LLMOps.Pro/NOSTR/NOSTRAS/agent
nohup node src/index.js > state/agent.log 2>&1 &
echo $! > state/agent.pid
disown
```
This detaches it from your terminal (`nohup` + `disown`), so it survives
you closing that terminal — but **not** a machine reboot, since nothing
currently re-launches it automatically on boot. If you close the
terminal without `nohup`, the process dies with it. The `state/agent.pid`
file is what makes the status/stop commands here reliable regardless of
how many other `node` processes happen to be running on this machine.

To stop it cleanly:
```sh
cd /home/user/Documents-LENOVO/LLMOps.Pro/NOSTR/NOSTRAS/agent
[ -f state/agent.pid ] && kill "$(cat state/agent.pid)" && rm state/agent.pid
```

Logs live at `agent/state/agent.log` (also worth checking
`agent/state/state.json` if something seems stuck — it holds the current
Claude session id and the set of already-processed messages).

**If you want real crash/reboot resilience** (auto-start on boot,
auto-restart on crash) rather than the current manual process, that's a
straightforward follow-up — a systemd user service or a cron `@reboot`
entry would cover it. Not built yet since "always-on desktop, started
manually" was the stated v1 scope; ask if you want it added.

---

# 2. Nostras Agent — public lead-gen agent (concept, not yet built)

**Status: scoping only.** Nothing described in this section exists yet
— no new identity, no Fly machine, no landing page. This is a record of
the concept and the open decisions, written down so the next session
that picks this up doesn't have to re-derive it. Brainstormed and scoped
2026-08-17, directly following the Desktop Agent's first successful
real-DM verification.

## The idea

A second, **separate** Nostr identity — never the same one as the
Desktop Agent above, and never able to touch this repo or your private
conversation with your own agent. Its job is business development, not
coding: explain honestly what it is (an AI agent, publicly demonstrating
what "bring your own agent to Nostr" looks like), engage with the Nostr
community where genuinely relevant, and mention that people who want
something similar for themselves can DM MMO directly.

**The explicit reframing this was scoped around, agreed in full**: the
objective is "explain itself honestly and engage where genuinely
relevant," with follower growth as a *side effect*, not the target
metric — deliberately not another engagement-farming bot. This matches
the project's own already-established growth philosophy (trust over
volume — see the `nostras_growth_strategy_selectivity` memory) and the
real, already-proven precedent this project has for exactly this shape
of thing: `SOVEREIGN_CITIZENS`, a second identity already run as "a
local-first AI agent that runs a business," which reached ~500
followers organically without any of this being built — real evidence
the underlying idea works in this exact ecosystem, not a hypothesis.

**The bigger thesis this agent is marketing for, not itself**: a
generic, LLM-agnostic "bring your own agent to Nostr" service — not
scoped to NOSTRAS specifically, and not scoped to Anthropic/Claude
specifically. Because the underlying mechanism (an LLM-driven agent
controllable via NIP-17 DM) is a protocol-level integration, anyone on
*any* NIP-17-compliant client could talk to an agent built this way —
this is a real differentiator worth taking seriously as a "world-first"
framing, not just NOSTRAS marketing copy. This agent is the top-of-funnel
for that eventual product, not the product itself — the product (a real
generic, multi-tenant, self-serve platform) is a separate, much larger
build that hasn't been scoped yet and shouldn't be conflated with
shipping this one evangelist identity.

## Content autonomy — explicitly decided, a real departure worth naming

Asked directly whether "100% autonomous" meant operational autonomy
(runs on its own schedule, no need for MMO to trigger it) or content
autonomy (posts and engages with strangers with no review step) —
**the user chose fully autonomous, no review.** This is a deliberate,
informed choice, not an oversight: every other public-facing action in
this entire project's history (`/engage`, every real reply, every real
post) has gone through a human-approval step before publishing. This
agent will be the first exception. Worth remembering precisely because
it's a real departure, not because it's wrong — the tradeoff was named
clearly before the decision was made.

**Given no pre-publish review, a stop/pause mechanism is not optional**
— a fast, reliable way to take the identity offline if it posts
something wrong is a different thing from a review gate, and is needed
regardless of the autonomy decision above. Not yet designed.

## Real open questions, not yet resolved

- **Infrastructure**: needs its own dedicated, always-on Fly.io machine
  (separate from MMO's desktop, since — unlike the Desktop Agent — it
  can't depend on this specific machine being on). A real, recurring
  cost — per this project's own standing practice, needs the user's
  explicit go-ahead before actually provisioning anything, the same way
  every prior Fly resource in this project was confirmed first (dedicated
  IPs, CPU tier upgrades, etc.).
- **Landing page**: a new page describing the "bring your agent to
  Nostr" concept — genuinely a different product line from the existing
  `nostras.app`/`/why`/`/node`/`/stats` pages (which are about the
  NOSTRAS client+relay specifically). Own domain/brand vs. a subdomain
  of `nostras.app` is an open question, not decided — "world-wide
  premiere service" framing suggests this might outgrow being framed as
  a NOSTRAS feature at all.
- **Content policy**: what it's actually allowed to post about, tone,
  cadence, and how it stays honest about its own capabilities (matching
  `SOVEREIGN_CITIZENS`' own established honest-positioning precedent) —
  needs real definition before anything ships autonomously, given there's
  no human review step to catch a bad post after the fact.
- **The eventual generic platform's own scope** (multi-tenant, per-customer
  isolation, billing, abuse prevention, which LLM backends are actually
  supported) — explicitly out of scope for this agent's own build; a
  separate, much larger initiative to plan later.

## Next step

Not started. When ready to move from concept to plan, this needs its
own dedicated planning pass (new identity, Fly deploy shape, the content
policy, the stop/pause mechanism) — same process the Desktop Agent went
through, kept as its own effort rather than folded into this document
further until there's something real to operate.
