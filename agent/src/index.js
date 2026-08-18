// Must be the very first thing evaluated — before ANY other import in
// this module graph, since identity.js (imported below) transitively
// imports @nostr-dev-kit/ndk too, and NDK's relay code does a bare
// `new WebSocket(url)` against the global. Putting this ahead of every
// other import (not just ndkClient.js's own, redundant copy) guarantees
// correct ordering regardless of which module happens to import NDK
// first in the dependency graph.
import { WebSocket } from 'ws'
globalThis.WebSocket = WebSocket

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from './env.js'
import { log } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnvFile(path.join(__dirname, '..', 'agent.env'))

const { loadOrCreateIdentity } = await import('./identity.js')
const { buildNdk, LISTEN_RELAY_URLS } = await import('./ndkClient.js')
const { subscribeToInbox } = await import('./dmInbox.js')
const { sendReply } = await import('./dmOutbox.js')
const { processMessage } = await import('./claudeSession.js')
const { startReconnectLoop } = await import('./relayReconnect.js')

// The real, already-public MMO pubkey used throughout this project's own
// verification history — the sole trusted sender. Overridable via env in
// case this ever needs to run for a different owner, but never left
// unset: an unset allowlist would mean trusting nobody, not everybody,
// so this has no insecure default to fall back to.
const OWNER_PUBKEY_HEX =
  process.env.NOSTR_AGENT_OWNER_PUBKEY ||
  '0da1a169a4e684d0b0ac1a370871575e4b8f3c56c8a7411b9ff7f27aea6c90e7'

async function main() {
  const signer = loadOrCreateIdentity()
  const ndk = buildNdk(signer)

  log.info('Starting nostr-agent', {
    agentNpub: signer.npub,
    ownerPubkey: OWNER_PUBKEY_HEX,
    listenRelays: LISTEN_RELAY_URLS,
  })

  // Bounded initial attempt — relayReconnect's own loop (started below)
  // picks up anything that doesn't connect in time, so this never blocks
  // startup indefinitely (the documented ndk.connect()-with-no-timeout
  // gotcha already learned once in client/src/lib/App.tsx).
  try {
    await ndk.connect(10000)
  } catch (e) {
    log.warn('Initial connect did not fully complete, reconnect loop will retry', {
      error: e instanceof Error ? e.message : String(e),
    })
  }

  const agentPubkeyHex = signer.pubkey

  const onOwnerMessage = async (content) => {
    const reply = await processMessage(content)
    try {
      await sendReply(ndk, agentPubkeyHex, OWNER_PUBKEY_HEX, reply)
    } catch (e) {
      log.error('Failed to send reply DM', { error: e instanceof Error ? e.message : String(e) })
    }
  }

  // Torn down and reissued on every listen-relay recovery, not just
  // created once — confirmed live, not hypothetical: a subscription left
  // open across a relay disconnect/reconnect cycle silently missed a
  // real message published during the gap, because NDK never resends an
  // existing subscription's REQ to a relay that reconnects on its own
  // (same root cause already fixed once in this project's client, see
  // relayReconnect.js's own comment). Re-issuing is safe and idempotent
  // regardless of cause — the persisted processedWraps set in state.js
  // means anything already handled is silently skipped, not replayed.
  let currentSub = null
  function resubscribe(reason) {
    log.info('(Re)subscribing to DM inbox', { reason })
    if (currentSub) currentSub.stop()
    currentSub = subscribeToInbox(ndk, agentPubkeyHex, OWNER_PUBKEY_HEX, signer, onOwnerMessage)
  }

  resubscribe('initial')
  const stopReconnectLoop = startReconnectLoop(ndk, (url) => resubscribe(`relay recovered: ${url}`))

  log.info('nostr-agent is listening')

  const shutdown = (signal) => {
    log.info('Shutting down', { signal })
    stopReconnectLoop()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((e) => {
  log.error('Fatal startup error', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})
