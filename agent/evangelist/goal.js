// The challenge: grow the wallet to 100x everything invested in the agent.
// Invested = starting sats + every live run's Claude cost, converted to sats
// at the BTC price when that run happened (stored per run as costSats).
// Dry-run costs are setup and don't count.
import { readFileSync } from 'node:fs'
import { RUNS_LOG } from './config.js'

export const GOAL_MULTIPLIER = 100

export function startSats() {
  return Number(process.env.AGENT_START_SATS || '2500')
}

// Live BTC price in USD (CoinGecko, no key). Returns null on failure, in
// which case the run's cost is converted with the last known rate.
export async function fetchBtcUsd() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {
      signal: AbortSignal.timeout(5000),
    })
    const body = await res.json()
    const usd = Number(body?.bitcoin?.usd)
    return usd > 0 ? usd : null
  } catch {
    return null
  }
}

export function usdToSats(usd, btcUsd) {
  return Math.ceil((usd / btcUsd) * 1e8)
}

function liveRuns() {
  try {
    return readFileSync(RUNS_LOG, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => r.dryRun === false)
  } catch {
    return []
  }
}

export function lastKnownBtcUsd() {
  try {
    const runs = readFileSync(RUNS_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    for (let i = runs.length - 1; i >= 0; i--) if (runs[i].btcUsd) return runs[i].btcUsd
  } catch {}
  return null
}

export function goalStatus() {
  const runs = liveRuns()
  const costSats = runs.reduce((s, r) => s + (r.costSats || 0), 0)
  const costUsd = runs.reduce((s, r) => s + (r.costUsd || 0), 0)
  const invested = startSats() + costSats
  return { startSats: startSats(), costSats, costUsd, investedSats: invested, goalSats: invested * GOAL_MULTIPLIER }
}
