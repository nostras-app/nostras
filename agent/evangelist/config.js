import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const AGENT_DIR = path.join(__dirname, '..')
export const REPO_ROOT = path.join(AGENT_DIR, '..')
export const STATE_DIR = path.join(AGENT_DIR, 'state')
export const TOOL_PATH = path.join(__dirname, 'tool.js')

// Dry run is the default: nothing is published or paid unless
// AGENT_DRY_RUN=0 is set explicitly in agent.env.
export function isDryRun() {
  return process.env.AGENT_DRY_RUN !== '0'
}

// Dry-run and live keep separate ledgers, so dry-run activity never eats
// into the live limits.
export function ledgerPath() {
  return path.join(STATE_DIR, isDryRun() ? 'evangelist-dry.json' : 'evangelist.json')
}
export const ACTIONS_LOG = path.join(STATE_DIR, 'actions.jsonl')
export const RUNS_LOG = path.join(STATE_DIR, 'evangelist-runs.jsonl')

// Hard limits, enforced in tool.js before anything is signed or paid.
// AGENT_CAP_SCALE (e.g. 0.5 for the first live week) scales the daily
// counts and zap budgets, never upward past these base values.
const BASE_CAPS = {
  postsPerDay: 4,
  minPostGapSec: 2 * 60 * 60,
  repliesPerDay: 10,
  reactionsPerDay: 20,
  zapMaxSats: 21,
  zapSatsPerDay: 100,
  zapSatsLifetime: 1000,
  articleMinGapSec: 7 * 24 * 60 * 60,
  maxNoteChars: 1200,
  maxArticleChars: 20000,
}

export function caps() {
  const scale = Math.min(1, Math.max(0, Number(process.env.AGENT_CAP_SCALE ?? '1') || 1))
  return {
    ...BASE_CAPS,
    postsPerDay: Math.floor(BASE_CAPS.postsPerDay * scale),
    repliesPerDay: Math.floor(BASE_CAPS.repliesPerDay * scale),
    reactionsPerDay: Math.floor(BASE_CAPS.reactionsPerDay * scale),
    zapSatsPerDay: Math.floor(BASE_CAPS.zapSatsPerDay * scale),
  }
}

export const DAILY_COST_CAP_USD = Number(process.env.AGENT_DAILY_COST_USD || '2')
export const MODEL = process.env.AGENT_EVANGELIST_MODEL || 'sonnet'

// Where the agent publishes. Its own listen relays plus nos.lol for reach.
export const PUBLISH_RELAYS = [
  'wss://nostras.app',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
]

// Where it reads other people's notes from.
export const READ_RELAYS = ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol']
export const SEARCH_RELAYS = ['wss://search.nos.today', 'wss://relay.nostr.band', 'wss://nostras.app']

// Calendar day in Zurich, used to reset the daily counters.
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date())
}
