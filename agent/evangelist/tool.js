// The only way the evangelist model can act on the network. Every limit is
// checked here, in code, before anything is signed, published or paid; the
// model's instructions are not the safety boundary.
//
// Usage: node agent/evangelist/tool.js <command> '<json args>'
// Prints one JSON object: { ok: true, ... } or { ok: false, error }.
import { WebSocket } from 'ws'
globalThis.WebSocket = WebSocket
process.env.NOSTR_AGENT_QUIET = '1'

import path from 'node:path'
import { NDKEvent, NDKRelaySet, getNip57ZapSpecFromLud } from '@nostr-dev-kit/ndk'
import { loadEnvFile } from '../src/env.js'
import { AGENT_DIR, caps, isDryRun, PUBLISH_RELAYS, READ_RELAYS, SEARCH_RELAYS } from './config.js'

loadEnvFile(path.join(AGENT_DIR, 'agent.env'))

const { loadOrCreateIdentity } = await import('../src/identity.js')
const { buildNdk } = await import('../src/ndkClient.js')
const { loadLedger, saveLedger, dayEntry, logAction } = await import('./ledger.js')
const nwc = await import('./nwc.js')

const OWNER_PUBKEY =
  process.env.NOSTR_AGENT_OWNER_PUBKEY ||
  '0da1a169a4e684d0b0ac1a370871575e4b8f3c56c8a7411b9ff7f27aea6c90e7'

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
  process.exit(obj.ok ? 0 : 1)
}
function fail(error) {
  out({ ok: false, error })
}

const [, , command, rawArgs = '{}'] = process.argv
let args
try {
  args = JSON.parse(rawArgs)
} catch {
  fail('Arguments must be a single JSON object')
}

const signer = loadOrCreateIdentity()
const ndk = buildNdk(signer)
await ndk.connect(8000).catch(() => {})
const selfPubkey = signer.pubkey

function relaySet(urls) {
  return NDKRelaySet.fromRelayUrls(urls, ndk)
}

// Collects events until EOSE from every relay or the timeout, whichever is first.
function fetchEvents(filter, urls, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const seen = new Map()
    const sub = ndk.subscribe(filter, { closeOnEose: true, relaySet: relaySet(urls) })
    const done = () => {
      sub.stop()
      resolve([...seen.values()])
    }
    const timer = setTimeout(done, timeoutMs)
    sub.on('event', (e) => seen.set(e.id, e))
    sub.on('eose', () => {
      clearTimeout(timer)
      done()
    })
  })
}

async function fetchEvent(id) {
  if (!/^[0-9a-f]{64}$/.test(id ?? '')) return null
  const events = await fetchEvents({ ids: [id] }, [...READ_RELAYS, 'wss://nostras.app'])
  return events[0] ?? null
}

function brief(e) {
  return {
    id: e.id,
    author: e.pubkey,
    kind: e.kind,
    created_at: e.created_at,
    content: (e.content ?? '').slice(0, 600),
  }
}

// Blocks content that could be harmful or embarrassing regardless of what
// the model was persuaded to write.
const FORBIDDEN = [
  /\bnsec1[0-9a-z]{20,}/i,
  /\blnbc[0-9a-z]{20,}/i,
  /pump\.fun/i,
  /\bairdrop\b/i,
  /\bcontract address\b/i,
  /\bpresale\b/i,
  /\$[A-Z]{2,10}\b/, // $TICKER-style token mentions
  /\b(memecoin|shitcoin)\b/i,
]
function checkContent(text, maxChars) {
  if (typeof text !== 'string' || !text.trim()) return 'content is empty'
  if (text.length > maxChars) return `content is longer than ${maxChars} characters`
  const hit = FORBIDDEN.find((re) => re.test(text))
  if (hit) return 'content contains a forbidden pattern (keys, invoices, or token/coin promotion)'
  return null
}

function looksLikeBot(e) {
  const c = (e.content ?? '').trim()
  return c.startsWith('{') || c.startsWith('[')
}

async function publish(event, action, summary) {
  if (isDryRun()) {
    logAction({ action, ...summary, published: false })
    return { ok: true, dryRun: true, note: 'DRY RUN: logged, not published', ...summary }
  }
  await event.sign()
  const relays = await event.publish(relaySet(PUBLISH_RELAYS), 8000)
  const accepted = [...relays].map((r) => r.url)
  logAction({ action, ...summary, eventId: event.id, relays: accepted })
  return { ok: true, eventId: event.id, relays: accepted, ...summary }
}

const c = caps()
const ledger = loadLedger()
const day = dayEntry(ledger)
const now = Math.floor(Date.now() / 1000)

switch (command) {
  case 'limits': {
    out({
      ok: true,
      dryRun: isDryRun(),
      today: day,
      remaining: {
        posts: Math.max(0, c.postsPerDay - day.post),
        nextPostAllowedAt: ledger.lastPostAt + c.minPostGapSec,
        replies: Math.max(0, c.repliesPerDay - day.reply),
        reactions: Math.max(0, c.reactionsPerDay - day.react),
        zapSatsToday: Math.max(0, c.zapSatsPerDay - day.zapSats),
        zapSatsLifetime: Math.max(0, c.zapSatsLifetime - ledger.lifetimeZapSats),
        zapMaxPerZap: c.zapMaxSats,
        articleAllowedAt: ledger.lastArticleAt + c.articleMinGapSec,
      },
    })
    break
  }

  case 'wallet': {
    try {
      const balance = await nwc.getBalanceSats()
      const txs = await nwc.listTransactions(15)
      out({
        ok: true,
        balanceSats: balance,
        recent: txs.map((t) => ({
          type: t.type,
          sats: Math.floor((t.amount ?? 0) / 1000),
          description: (t.description ?? '').slice(0, 120),
          settled_at: t.settled_at ?? null,
        })),
      })
    } catch (e) {
      fail(`wallet: ${e.message}`)
    }
    break
  }

  case 'search': {
    const query = String(args.query ?? '').slice(0, 100)
    if (!query) fail('query is required')
    const events = await fetchEvents({ kinds: [1], search: query, limit: 20 }, SEARCH_RELAYS)
    out({ ok: true, untrusted: true, results: events.filter((e) => e.pubkey !== selfPubkey).slice(0, 20).map(brief) })
    break
  }

  case 'thread': {
    const root = await fetchEvent(args.event_id)
    if (!root) fail('event not found')
    const replies = await fetchEvents({ kinds: [1], '#e': [root.id], limit: 30 }, READ_RELAYS)
    out({ ok: true, untrusted: true, event: brief(root), replies: replies.map(brief) })
    break
  }

  case 'post': {
    const err = checkContent(args.content, c.maxNoteChars)
    if (err) fail(err)
    if (day.post >= c.postsPerDay) fail(`daily post limit reached (${c.postsPerDay})`)
    if (now < ledger.lastPostAt + c.minPostGapSec) fail('too soon after the last post (minimum 2 hours)')
    const tags = (Array.isArray(args.hashtags) ? args.hashtags : [])
      .slice(0, 5)
      .map((t) => ['t', String(t).replace(/^#/, '').toLowerCase()])
    const event = new NDKEvent(ndk, { kind: 1, content: args.content, tags })
    const result = await publish(event, 'post', { content: args.content })
    day.post += 1
    ledger.lastPostAt = now
    saveLedger(ledger)
    out(result)
    break
  }

  case 'reply': {
    const err = checkContent(args.content, c.maxNoteChars)
    if (err) fail(err)
    if (day.reply >= c.repliesPerDay) fail(`daily reply limit reached (${c.repliesPerDay})`)
    const target = await fetchEvent(args.event_id)
    if (!target) fail('event not found')
    if (target.kind !== 1) fail('can only reply to kind:1 notes')
    if (target.pubkey === selfPubkey) fail('will not reply to my own note')
    if (looksLikeBot(target)) fail('target looks like a bot/data note')
    if (day.repliedTo.includes(target.pubkey) && target.pubkey !== OWNER_PUBKEY) {
      fail('already replied to this person today')
    }
    const rootTag = target.tags.find((t) => t[0] === 'e' && t[3] === 'root')
    const tags = [
      ...(rootTag ? [['e', rootTag[1], '', 'root'], ['e', target.id, '', 'reply']] : [['e', target.id, '', 'root']]),
      ['p', target.pubkey],
    ]
    const event = new NDKEvent(ndk, { kind: 1, content: args.content, tags })
    const result = await publish(event, 'reply', { to: target.id, toAuthor: target.pubkey, content: args.content })
    day.reply += 1
    day.repliedTo.push(target.pubkey)
    saveLedger(ledger)
    out(result)
    break
  }

  case 'react': {
    if (day.react >= c.reactionsPerDay) fail(`daily reaction limit reached (${c.reactionsPerDay})`)
    const target = await fetchEvent(args.event_id)
    if (!target) fail('event not found')
    if (target.pubkey === selfPubkey) fail('will not react to my own note')
    const event = new NDKEvent(ndk, {
      kind: 7,
      content: '+',
      tags: [['e', target.id], ['p', target.pubkey], ['k', String(target.kind)]],
    })
    const result = await publish(event, 'react', { to: target.id, toAuthor: target.pubkey })
    day.react += 1
    saveLedger(ledger)
    out(result)
    break
  }

  case 'zap': {
    const sats = Math.floor(Number(args.sats))
    if (!Number.isFinite(sats) || sats < 1) fail('sats must be a positive whole number')
    if (sats > c.zapMaxSats) fail(`a single zap is limited to ${c.zapMaxSats} sats`)
    if (day.zapSats + sats > c.zapSatsPerDay) fail(`daily zap budget would be exceeded (${c.zapSatsPerDay} sats)`)
    if (ledger.lifetimeZapSats + sats > c.zapSatsLifetime) fail(`lifetime zap budget would be exceeded (${c.zapSatsLifetime} sats)`)
    const comment = String(args.comment ?? '').slice(0, 140)
    if (comment && checkContent(comment, 140)) fail('comment contains a forbidden pattern')
    const target = await fetchEvent(args.event_id)
    if (!target) fail('event not found')
    if (target.pubkey === selfPubkey) fail('will not zap my own note')

    // The recipient's Lightning address comes only from their own kind:0,
    // never from the model or from anyone's message.
    const profiles = await fetchEvents({ kinds: [0], authors: [target.pubkey] }, READ_RELAYS)
    const profileEv = profiles.sort((a, b) => b.created_at - a.created_at)[0]
    let profile = {}
    try {
      profile = JSON.parse(profileEv?.content ?? '{}')
    } catch {}
    const lud16 = profile.lud16
    if (!lud16 || !lud16.includes('@')) fail('recipient has no Lightning address (lud16)')

    if (isDryRun()) {
      logAction({ action: 'zap', to: target.id, toAuthor: target.pubkey, sats, lud16, comment, paid: false })
      day.zapSats += sats
      ledger.lifetimeZapSats += sats
      saveLedger(ledger)
      out({ ok: true, dryRun: true, note: 'DRY RUN: logged, not paid', to: target.id, sats, lud16 })
    }

    const spec = await getNip57ZapSpecFromLud({ lud16 }, ndk)
    if (!spec?.callback) fail('could not resolve the recipient Lightning address')
    const amountMsat = sats * 1000
    if (spec.minSendable && amountMsat < spec.minSendable) fail('amount below the recipient minimum')
    const [name, domain] = lud16.split('@')
    const zapRequest = new NDKEvent(ndk, {
      kind: 9734,
      content: comment,
      tags: [
        ['relays', ...PUBLISH_RELAYS],
        ['amount', String(amountMsat)],
        ['lnurl', `https://${domain}/.well-known/lnurlp/${name}`],
        ['p', target.pubkey],
        ['e', target.id],
        ['k', String(target.kind)],
      ],
    })
    await zapRequest.sign()
    const url = new URL(spec.callback)
    url.searchParams.set('amount', String(amountMsat))
    url.searchParams.set('nostr', JSON.stringify(zapRequest.rawEvent()))
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const body = await res.json().catch(() => ({}))
    if (!body.pr) fail(`recipient did not return an invoice: ${body.reason ?? res.status}`)

    // Record the spend BEFORE paying, so a crash mid-payment can never let
    // the agent exceed its budget by retrying.
    day.zapSats += sats
    ledger.lifetimeZapSats += sats
    saveLedger(ledger)
    try {
      const paid = await nwc.payInvoice(body.pr)
      logAction({ action: 'zap', to: target.id, toAuthor: target.pubkey, sats, lud16, comment, paid: true, preimage: paid?.preimage })
      out({ ok: true, to: target.id, sats, lud16 })
    } catch (e) {
      logAction({ action: 'zap', to: target.id, toAuthor: target.pubkey, sats, lud16, comment, paid: false, error: e.message })
      fail(`payment failed (budget still counted, as a precaution): ${e.message}`)
    }
    break
  }

  case 'article': {
    const err = checkContent(args.content, c.maxArticleChars)
    if (err) fail(err)
    if (!args.title || String(args.title).length > 120) fail('title is required (max 120 chars)')
    if (now < ledger.lastArticleAt + c.articleMinGapSec) fail('one article per week')
    const d = String(args.d ?? `nostras-agent-report-${new Date().toISOString().slice(0, 10)}`)
    const event = new NDKEvent(ndk, {
      kind: 30023,
      content: args.content,
      tags: [
        ['d', d],
        ['title', String(args.title)],
        ...(args.summary ? [['summary', String(args.summary).slice(0, 300)]] : []),
        ['published_at', String(now)],
      ],
    })
    const result = await publish(event, 'article', { title: args.title, d, content: args.content })
    ledger.lastArticleAt = now
    saveLedger(ledger)
    out(result)
    break
  }

  default:
    fail(`unknown command "${command}". Commands: limits, wallet, search, thread, post, reply, react, zap, article`)
}
