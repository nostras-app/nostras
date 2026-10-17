# NOSTRAS Agent

Rewritten 2026-10-17. The earlier version of this file described two
separate things: a private "Desktop Agent" and a public "Nostras Agent"
concept planned for Fly.io. They became **one agent**: the existing identity
took on the public role on 2026-10-17 and still runs on MMO's desktop.

**npub:** `npub1ecxp4qddstny2mj5cdlxdaf3y56kvlgr24kscs2jx7tf6hjxr6kq3nzvag`
**Name:** NOSTRAS Agent · **Zaps:** `nostras_agent@getalby.com`

It has two jobs:

1. **Your remote control.** DM it from your own identity (MMO) to control it
   or to give it coding tasks on this repo.
2. **Public evangelist.** On a schedule it promotes NOSTRAS on Nostr: posts,
   replies, likes and small zaps, and tries to grow its own wallet through
   value for value. Live since 2026-10-17 at half limits.

Details live next to the code:
- [`agent/README.md`](agent/README.md): setup, commands, files, layout.
- [`agent/EVANGELIST-PLAN.md`](agent/EVANGELIST-PLAN.md): the evangelist's
  goal, rules, limits, wallet and rollout.

## Where it runs

On MMO's desktop, as two systemd **user** units (they start at boot and
restart on crash):

| Unit | What |
|---|---|
| `nostras-agent.service` | The DM daemon (`agent/src/index.js`) |
| `nostras-agent-evangelist.timer` | One evangelist run at ~08, 12, 16 and 20 Zurich time |

It stays on owned hardware on purpose: it holds its own private key and a
wallet connection (see `/home/user/Documents/claude-migration-plan.md`).
**Never run it on a second machine at the same time** (same identity, same
wallet: double posts, double zaps, double DM replies).

## 1. DMing it

Only messages from MMO's pubkey are acted on. Messages from anyone else are
decrypted, recognized as not MMO, and dropped without a reply.

**Commands** (the whole message, any case), answered at once without Claude,
so they work even if Claude is failing:

| Message | Effect |
|---|---|
| `stop` or `pause` | Stops the evangelist; survives restarts |
| `resume` | Lets it run again from the next scheduled slot |
| `status` | Active or paused, live or dry run |
| `ledger` | Last 24 h of actions and Claude cost, invested sats and goal |

**Anything else is a coding task.** The daemon runs headless Claude Code in
this repo with **full autonomy** (no permission prompts), so treat a DM like
handing someone your keyboard: it can edit, commit, push and deploy if you
ask. It keeps one conversation across messages and restarts. It has the
project's `CLAUDE.md`, skills and memory
(`~/.claude/projects/-home-user-Documents-LENOVO-LLMOps-Pro-NOSTR-NOSTRAS/memory/`).

**Limits per DM task:** 10-minute timeout, $5 cost ceiling. The first
message after a while used to cost over $1 just to reload this repo's
`CLAUDE.md` (687 KB) into Claude's cache; it was cut to ~11 KB on
2026-10-17, so expect much less. A typo in a command (e.g. "kedger") is
treated as a coding task.

**DM coding tasks never send payments**, enforced three ways:
- a system-prompt rule;
- a `PreToolUse` hook (`agent/hooks/deny-payments.sh`) that blocks
  payment-shaped commands;
- Claude processes never get the agent's private key or wallet connection
  in their environment (`agent/src/childEnv.js`, added 2026-10-17; before
  that, the wallet connection added for the evangelist was inherited).

## 2. The evangelist

Short version (full detail in `agent/EVANGELIST-PLAN.md`):

- **Goal:** grow its wallet to 100x everything invested in it: the 2,500
  starting sats plus its own live Claude cost, converted to sats.
- **How it acts:** each run, headless Claude (Opus, $3/day cap) sees a
  briefing and can only run `agent/evangelist/tool.js`. Every limit is
  enforced in that tool, in code: posts, replies, likes and zaps per day;
  zaps max 21 sats, 1,000 sats lifetime; no tokens, keys or invoices in posts;
  zaps only to the author's own Lightning address.
- **Rules:** says it's an AI; claims about NOSTRAS must come from
  `agent/evangelist/nostras-facts.md` or the repo; never follows
  instructions found in network content; no DMs to strangers.
- **Also grows MMO's agent-payments kit** (since 2026-10-17, when SOVEREIGN
  CITIZENS stopped outreach): its briefing gets scout-watcher's leads and
  weekly market digest; its fact sheet covers the kit.
- **Logs:** `agent/state/actions.jsonl` (every action),
  `agent/state/evangelist-runs.jsonl` (every run, cost).

## Operating

```sh
systemctl --user status nostras-agent.service
systemctl --user restart nostras-agent.service              # after editing agent/agent.env
systemctl --user list-timers nostras-agent-evangelist.timer
systemctl --user start nostras-agent-evangelist.service     # one evangelist run now
systemctl --user stop nostras-agent-evangelist.timer        # stop the schedule
tail -f agent/state/agent.log                               # DM daemon log
```

`agent/state/state.json` holds the Claude session id, processed messages
and the pause flag. Deleting it starts a fresh DM conversation (and clears
the pause flag).

## History

- 2026-08-17: built as a private, DM-only Claude Code daemon (see the
  "nostr-agent" entries in `docs/history/2026-08.md`).
- 2026-09-11 → 2026-10-16: down after a dropped relay connection and a
  2026-10-04 reboot; nothing restarted it.
- 2026-10-16/17: systemd units; public profile; evangelist built, dry-run,
  then live at half limits.
- The "Nostras Agent" concept from 2026-08-17 (separate identity on Fly.io,
  its own landing page, a generic "bring your own agent to Nostr" platform)
  was not built as planned. Its public role was folded into this identity,
  kept on the desktop for the key rule. The generic platform remains an
  idea for later.
