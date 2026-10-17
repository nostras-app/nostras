// Growth inputs inherited from SOVEREIGN CITIZENS (decision 2026-10-17: that
// account rests, the NOSTRAS Agent grows the Nostr business). scout-watcher
// (NOSTR project, desktop systemd) keeps scanning for people talking about
// agent payments / L402 / x402 / paid MCP / DVMs and writes scored "lead"
// lines to its queue; its weekly market digest summarizes them. The
// evangelist reads both, read-only. Everything here is network content
// written by strangers: the briefing marks it untrusted.
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STATE_DIR = process.env.NOSTR_MERCHANT_STATE_DIR || path.join(os.homedir(), '.nostr-merchant')
const QUEUE_PATH = path.join(STATE_DIR, 'scout-queue.ndjson')
const DIGEST_PATH = path.join(STATE_DIR, 'market-digest.json')

// Accounts seen flooding these topics with automated pitches or bot answers
// (/engage sessions, 2026-10-17). Matched by pubkey prefix. Extend with
// AGENT_SCOUT_IGNORE (comma-separated prefixes).
const NOISE_PREFIXES = [
  'cdb618cf', // DiversZ "CALL_FOR_AIS", every ~2.5 min
  'd01b460c', // Agent One / invinoveritas
  '79498097', // invinoveritas pitches
  '09fad3a8', // automated answer + service pitches
  'd1433712', // automated answer account
  'e6a35697', // repeated red-team scanner pitch
  '0f0db1c9', // DOH.MONEY news bot
]

function noisePrefixes() {
  const extra = (process.env.AGENT_SCOUT_IGNORE || '').split(',').map((s) => s.trim()).filter(Boolean)
  return [...NOISE_PREFIXES, ...extra]
}

function looksLikeBot(content) {
  const c = (content || '').trim()
  if (c.startsWith('{') || c.startsWith('[')) return true
  const hashtags = (c.match(/#\w+/g) || []).length
  const words = c.split(/\s+/).length
  return hashtags >= 6 && hashtags > words / 4
}

/** Recent scored leads from scout-watcher, newest first. Never throws. */
export function readScoutLeads({ maxAgeHours = 48, minScore = 2, limit = 8, excludePubkeys = [] } = {}) {
  let lines = []
  try {
    lines = readFileSync(QUEUE_PATH, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeHours * 3600
  const noise = noisePrefixes()
  const seen = new Set()
  const leads = []
  for (let i = lines.length - 1; i >= 0 && leads.length < limit; i--) {
    let e
    try {
      e = JSON.parse(lines[i])
    } catch {
      continue
    }
    if (e.type !== 'lead' || !e.id || seen.has(e.id)) continue
    seen.add(e.id)
    if ((e.created_at || 0) < cutoff || (e.score || 0) < minScore) continue
    if (!e.author || excludePubkeys.includes(e.author)) continue
    if (noise.some((p) => e.author.startsWith(p))) continue
    if (looksLikeBot(e.content)) continue
    leads.push({
      id: e.id,
      author: e.author,
      created_at: e.created_at,
      score: e.score,
      topics: e.topics || [],
      content: (e.content || '').replace(/\s+/g, ' ').slice(0, 400),
    })
  }
  return leads
}

/** The weekly market digest summary, if it's recent enough. Never throws. */
export function readMarketDigest({ maxAgeDays = 8 } = {}) {
  try {
    const d = JSON.parse(readFileSync(DIGEST_PATH, 'utf8'))
    const age = Date.now() - Date.parse(d.generated_at)
    if (!(age >= 0 && age <= maxAgeDays * 86400 * 1000)) return null
    return { generatedAt: d.generated_at, thin: Boolean(d.thin), summary: String(d.summary || '').slice(0, 2500) }
  } catch {
    return null
  }
}
