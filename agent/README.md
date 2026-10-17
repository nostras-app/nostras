# NOSTRAS Agent

A Nostr identity run by Claude on the operator's own desktop (never deployed,
never public infrastructure). It has two jobs:

1. **DM daemon**: the operator (MMO) DMs it over NIP-17 to control it or to
   give it coding tasks on this repo. It only takes instructions from MMO.
2. **Evangelist**: on a schedule, it promotes NOSTRAS on Nostr, posts, replies,
   likes and zaps, and tries to grow its own wallet through value for value.
   Full description, limits and rollout: [`EVANGELIST-PLAN.md`](EVANGELIST-PLAN.md).

More background: the DM daemon's original design is in the project
`CLAUDE.md` (the nostr-agent entries) and `../NOSTRAS-AGENT.md`.

## Setup

```sh
cd agent
npm install
cp agent.env.example agent.env   # optional; see the comments inside
node src/index.js                # first boot generates and saves an identity
# Ctrl+C once it logs the new npub
npm run setup-identity           # publishes kind:0 + kind:10050 so DMs can find it
```

Then install the systemd user units (adjust the paths in them first):

```sh
cp systemd/* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now nostras-agent.service           # DM daemon
systemctl --user enable --now nostras-agent-evangelist.timer  # evangelist schedule
loginctl enable-linger "$USER"   # keep user units running without a login session
```

The evangelist starts in dry run (nothing published or paid) until
`AGENT_DRY_RUN=0` is set in `agent.env`. It needs `AGENT_NWC_URI` for its
wallet; see `agent.env.example` for every setting.

## Talking to it

DM the agent's npub from the owner's identity (e.g. in NOSTRAS):

| Message | Effect |
|---|---|
| `stop` or `pause` | Stops the evangelist (persists across restarts) |
| `resume` | Lets it run again on the next scheduled slot |
| `status` | Active or paused, live or dry run |
| `ledger` | Last 24 h of actions and Claude cost, invested sats and goal |
| anything else | Runs as a coding task on this repo |

Commands are matched on the whole message and answered without Claude.
Coding tasks run headless Claude Code with full autonomy
(`--permission-mode bypassPermissions`) and keep one conversation across
restarts, so only send tasks you'd be comfortable an unattended agent doing.
That mode never sends payments (prompt rule, the `hooks/deny-payments.sh`
hook, and Claude processes never receive the agent's key or wallet
connection: `src/childEnv.js`).

## Operating

```sh
systemctl --user status nostras-agent.service
systemctl --user restart nostras-agent.service              # after editing agent.env
systemctl --user list-timers nostras-agent-evangelist.timer
systemctl --user start nostras-agent-evangelist.service     # one evangelist run now
systemctl --user stop nostras-agent-evangelist.timer        # stop the schedule
node evangelist/tool.js limits                              # today's usage and limits
```

| File | What |
|---|---|
| `state/agent.log` | DM daemon log (JSON lines) |
| `state/state.json` | Claude session id, processed DMs, pause flag |
| `state/evangelist.json` | Live evangelist ledger (daily counts, zap totals, cost) |
| `state/actions.jsonl` | Every post, reply, like, zap and article |
| `state/evangelist-runs.jsonl` | Every evangelist run: summary, cost, BTC price |

`state/` and `agent.env` are gitignored. Deleting `state/state.json` starts a
fresh Claude conversation for DM tasks (and clears the pause flag).

## Layout

| Path | What |
|---|---|
| `src/` | DM daemon: identity, relays, NIP-17 inbox and replies, owner commands, Claude sessions |
| `evangelist/` | Scheduled run, the `tool.js` the model acts through, limits, ledger, goal, wallet client, fact sheet |
| `scripts/` | One-off helpers: `setup-identity.js`, `set-profile.js`, `update-profile.js` |
| `systemd/` | Copies of the user units |
| `hooks/` | Payment-deny hook for DM coding tasks |
