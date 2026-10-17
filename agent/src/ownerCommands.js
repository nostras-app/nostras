import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPaused, setPaused } from './state.js'
import { log } from './logger.js'

// Owner-only control commands. Returns a reply string when `content` is a
// command, or null when it should go to Claude as a normal task. The match
// is the whole message (trimmed, case-insensitive), so a task that merely
// mentions "stop" is never mistaken for the kill switch.
export function handleOwnerCommand(content) {
  const cmd = content.trim().toLowerCase()
  if (cmd === 'stop' || cmd === 'pause') {
    setPaused(true)
    log.info('Evangelist paused by owner')
    return 'Paused. I will not post, reply, react or zap until you send "resume". DM tasks still work.'
  }
  if (cmd === 'resume') {
    setPaused(false)
    log.info('Evangelist resumed by owner')
    return 'Resumed. The evangelist loop will run on its next scheduled slot.'
  }
  if (cmd === 'ledger') {
    return ledgerSummary()
  }
  if (cmd === 'status') {
    return `Evangelist: ${isPaused() ? 'paused' : 'active'}, ${process.env.AGENT_DRY_RUN === '0' ? 'live' : 'dry run (nothing is published or paid)'}.`
  }
  return null
}

// "ledger": what the evangelist did (or, in dry run, would have done) in the
// last 24 hours, read from the local action log. Kept short for a phone DM.

const stateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'state')

function readJsonl(file) {
  try {
    return readFileSync(path.join(stateDir, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

export function ledgerSummary() {
  const cutoff = Date.now() - 24 * 3600 * 1000
  const actions = readJsonl('actions.jsonl').filter((a) => Date.parse(a.ts) >= cutoff)
  const runs = readJsonl('evangelist-runs.jsonl').filter((r) => Date.parse(r.ts) >= cutoff)
  const cost = runs.reduce((s, r) => s + (r.costUsd || 0), 0)
  const lines = actions.slice(-8).map((a) => {
    const what = a.action === 'zap' ? `zap ${a.sats} sats` : a.action
    const text = (a.content ?? a.title ?? '').replace(/\s+/g, ' ').slice(0, 140)
    return `• ${what}${a.dryRun ? ' (dry run)' : ''}${text ? `: ${text}` : ''}`
  })
  return [
    `Last 24h: ${runs.length} runs, ${actions.length} actions, $${cost.toFixed(2)} Claude cost.`,
    ...(lines.length ? lines : ['No actions.']),
  ].join('\n')
}
