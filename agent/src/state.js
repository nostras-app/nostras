import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { log } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const statePath = path.join(__dirname, '..', 'state', 'state.json')

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60
const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60

function defaultState() {
  const now = Math.floor(Date.now() / 1000)
  return {
    claudeSessionId: null,
    // wrapId -> rumor's real created_at (seconds) — used to prune old
    // entries by age; the wrap's own created_at is deliberately
    // randomized by NIP-59 and never trustworthy for this.
    processedWraps: {},
    // rumorId -> rumor created_at. The same message can arrive in more
    // than one gift wrap (seen 2026-10-16: one DM handled twice), so
    // wrap ids alone don't dedupe it.
    processedRumors: {},
    firstBootAt: now,
    // Kill switch for the evangelist loop. Set by the owner's "stop"/"pause"
    // DM, cleared by "resume". Persisted so a restart can't silently resume.
    paused: false,
  }
}

let state = load()

function load() {
  try {
    const raw = readFileSync(statePath, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...defaultState(), ...parsed }
  } catch {
    return defaultState()
  }
}

function saveSync() {
  mkdirSync(path.dirname(statePath), { recursive: true })
  // Prune before every save — keeps the file bounded at single-user DM
  // volume without needing a separate scheduled job.
  const cutoff = Math.floor(Date.now() / 1000) - THIRTY_DAYS_SEC
  for (const [wrapId, createdAt] of Object.entries(state.processedWraps)) {
    if (createdAt < cutoff) delete state.processedWraps[wrapId]
  }
  for (const [rumorId, createdAt] of Object.entries(state.processedRumors ?? {})) {
    if (createdAt < cutoff) delete state.processedRumors[rumorId]
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

export function hasProcessedWrap(wrapId) {
  return Object.hasOwn(state.processedWraps, wrapId)
}

// Called BEFORE dispatching to Claude, not after — so a daemon crash
// mid-invocation can't cause the same message to be reprocessed into a
// second, duplicate Claude turn on restart. Synchronous write is
// deliberate for the same reason (no async gap between "decided to
// process" and "durably recorded that decision").
export function markWrapProcessed(wrapId, rumorCreatedAt) {
  state.processedWraps[wrapId] = rumorCreatedAt
  saveSync()
  log.info('Marked wrap processed', { wrapId, rumorCreatedAt })
}

export function getClaudeSessionId() {
  return state.claudeSessionId
}

export function setClaudeSessionId(id) {
  state.claudeSessionId = id
  saveSync()
}

// Purely a performance bound for the relay subscription's `since` filter
// — never a correctness mechanism (see markWrapProcessed's own comment;
// the wrap's created_at has no reliable relation to real send time).
// Generous 7-day margin before the daemon's own first-ever boot.
export function getSinceFloor() {
  return state.firstBootAt - SEVEN_DAYS_SEC
}

export function isPaused() {
  return state.paused === true
}

export function setPaused(paused) {
  state.paused = paused
  saveSync()
}

export function hasProcessedRumor(rumorId) {
  return Object.hasOwn(state.processedRumors ?? {}, rumorId)
}

export function markRumorProcessed(rumorId, rumorCreatedAt) {
  state.processedRumors ??= {}
  state.processedRumors[rumorId] = rumorCreatedAt
  saveSync()
}
