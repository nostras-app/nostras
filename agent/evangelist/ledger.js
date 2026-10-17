import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { ledgerPath, ACTIONS_LOG, today, isDryRun } from './config.js'

function empty() {
  return { days: {}, lastPostAt: 0, lastArticleAt: 0, lifetimeZapSats: 0 }
}

export function loadLedger() {
  try {
    return { ...empty(), ...JSON.parse(readFileSync(ledgerPath(), 'utf8')) }
  } catch {
    return empty()
  }
}

export function saveLedger(ledger) {
  mkdirSync(path.dirname(ledgerPath()), { recursive: true })
  // Keep 60 days of daily counters; older days no longer affect any limit.
  const keep = Object.keys(ledger.days).sort().slice(-60)
  ledger.days = Object.fromEntries(keep.map((d) => [d, ledger.days[d]]))
  writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2))
}

export function dayEntry(ledger) {
  const d = today()
  ledger.days[d] ??= { post: 0, reply: 0, react: 0, zapSats: 0, costUsd: 0, repliedTo: [] }
  return ledger.days[d]
}

export function logAction(entry) {
  mkdirSync(path.dirname(ACTIONS_LOG), { recursive: true })
  appendFileSync(
    ACTIONS_LOG,
    JSON.stringify({ ts: new Date().toISOString(), dryRun: isDryRun(), ...entry }) + '\n',
  )
}
