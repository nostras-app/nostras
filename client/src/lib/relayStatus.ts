import { normalizeRelayUrl, type NDKRelay } from '@nostr-dev-kit/ndk'
import { ndk, localRelayUrl } from './ndk'

// NDK normalizes every relay URL internally (always appends a trailing
// slash — normalizeRelayUrl("ws://localhost:7777") -> "ws://localhost:7777/"),
// so relay.url on the actual NDKRelay object never equals the bare
// localRelayUrl constant. Normalize this side too rather than hardcoding
// the slash, so this stays correct if NDK's normalization ever changes.
const normalizedLocalRelayUrl = normalizeRelayUrl(localRelayUrl)

// Tracks the local relay's connection health specifically, for two
// reasons:
//
// 1. NDK's own automatic reconnection only re-executes a subscription
//    that was still WAITING for the relay to become ready — a
//    subscription that had already started successfully and was RUNNING
//    when the relay dropped is never automatically re-sent once the
//    relay reconnects (confirmed by reading NDK's source:
//    NDKRelaySubscription only registers a "ready" listener from
//    execute() when the relay wasn't connected yet). Hooks depend on
//    `generation` here to know when to tear down and recreate their
//    subscription.
//
// 2. NDK's own retry *scheduling* turned out to be unreliable in
//    practice: verified live (kill the relay process, restart it,
//    watch) that NDK correctly detects the drop (its silence-detection
//    keepalive fires, disconnect is emitted, the status pill correctly
//    shows "reconnecting") but then never actually calls connect()
//    again on its own — confirmed by inspecting the relay's internal
//    state mid-hang (status stuck DISCONNECTED, no reconnectTimeout
//    pending) and confirming a *manual* relay.connect() call from that
//    exact stuck state succeeds immediately. So detection is left to
//    NDK (a legitimate, already-built mechanism), but retrying is done
//    here instead of trusting NDK's internal scheduler.
//
// The retry loop below also does NOT rely on the "relay:ready" event to
// notice its own success — also verified live that after this module's
// own relay.connect() call resolves and the relay is genuinely connected
// (relay.connected === true, checked directly), "relay:ready" does not
// reliably fire again on the pool for a relay that has already gone
// through one disconnect/reconnect cycle. So the retry loop checks
// relay.connected directly after each attempt instead of waiting on that
// event; the event listener below is kept too as a harmless, redundant
// second path in case it does fire.
export type LocalRelayStatus = 'connecting' | 'connected' | 'disconnected'

let status: LocalRelayStatus = 'connecting'
let generation = 0
const listeners = new Set<() => void>()
let retryTimer: ReturnType<typeof setTimeout> | undefined

const RETRY_INTERVAL_MS = 3000

function notify() {
  for (const listener of listeners) listener()
}

function isLocalRelay(relay: NDKRelay) {
  return relay.url === normalizedLocalRelayUrl
}

function getLocalRelay(): NDKRelay | undefined {
  return ndk.pool.relays.get(normalizedLocalRelayUrl)
}

function markConnected() {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
  // Only bump generation on a genuine recovery (disconnected -> connected)
  // — not on the very first connect, when there's nothing stale yet for a
  // subscription to recreate.
  if (status === 'disconnected') generation++
  status = 'connected'
  notify()
}

function scheduleRetry() {
  if (retryTimer) return
  retryTimer = setTimeout(async () => {
    retryTimer = undefined
    const relay = getLocalRelay()
    if (!relay) return
    if (!relay.connected) {
      try {
        await relay.connect()
      } catch {
        // Swallow — checked directly below regardless of outcome.
      }
    }
    if (relay.connected) markConnected()
    else scheduleRetry()
  }, RETRY_INTERVAL_MS)
}

ndk.pool.on('relay:ready', (relay: NDKRelay) => {
  if (!isLocalRelay(relay)) return
  markConnected()
})

ndk.pool.on('relay:disconnect', (relay: NDKRelay) => {
  if (!isLocalRelay(relay)) return
  status = 'disconnected'
  notify()
  scheduleRetry()
})

export function subscribeRelayStatus(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRelayStatus(): LocalRelayStatus {
  return status
}

export function getRelayGeneration(): number {
  return generation
}
