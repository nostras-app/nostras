# nostr-agent

A local, single-user Nostr-DM-controlled Claude Code daemon, scoped to
this repo only. Runs exclusively on the operator's own desktop — never
deployed, never public infrastructure. See `CLAUDE.md`'s dated entry for
the full design rationale, `/home/user/.claude/plans/crystalline-puzzling-gosling.md`
for the original implementation plan, and `../NOSTRAS-AGENT.md` (project
root) for the full operator-facing explanation: what it can actually do
when DMed, and how to restart it after a crash/reboot.

## Setup

```sh
cd agent
npm install
node src/index.js        # first boot: generates and persists an identity
# Ctrl+C once it logs the new npub
npm run setup-identity    # publishes kind:0 + kind:10050 so DMs can find it
node src/index.js         # start the daemon for real
```

DM the printed npub from your own NOSTRAS session to talk to it. Session
continuity is automatic (each daemon restart resumes the same Claude Code
conversation) — the daemon runs with full autonomy
(`--permission-mode bypassPermissions`), per an explicit choice made when
this was built, so only DM it from the owner's own identity and only ask
it things you'd be comfortable an unattended agent doing on this repo.

## Config

Copy `agent.env.example` to `agent.env` to override any default (cost
ceiling, timeout, owner pubkey). None of these are required — the daemon
generates its own identity and uses sensible defaults with nothing set.

## Operating

- Logs: `state/agent.log` (also echoed to stdout).
- State: `state/state.json` (Claude session id, processed-DM dedup set —
  safe to delete to force a fresh conversation, but you'll lose
  continuity).
- Run detached, with a PID file for reliable status checks:
  ```sh
  nohup node src/index.js > state/agent.log 2>&1 &
  echo $! > state/agent.pid
  disown
  ```
- Check status: `ps -p "$(cat state/agent.pid)"`.
- Stop: `kill "$(cat state/agent.pid)" && rm state/agent.pid` (or Ctrl+C
  if running attached to a terminal).
- Keep it running: this is deliberately just a plain long-running
  process — no auto-start on boot or auto-restart on crash built in yet,
  since "always-on desktop, started manually" was the stated scope for
  v1. A systemd user service or cron `@reboot` entry would be a
  straightforward follow-up if you want real crash/reboot resilience.
