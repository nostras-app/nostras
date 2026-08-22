import type { NDKNip46Signer, NDKPool, NDKRelay, NDKSubscription } from '@nostr-dev-kit/ndk'

// Real gap found live (2026-08-22), while investigating a real `nak
// bunker` session (SOVEREIGN_CITIZENS' remote signer) logging repeated
// "mute: no one was listening for this" — khatru's own, correct,
// protocol-mandated response when an ephemeral event (kind:24133, the
// NIP-46 request/response kind) has zero live subscribers on a relay at
// publish time.
//
// Root cause, confirmed by reading NDK's own source: `NDKNostrRpc` (the
// class handling all bunker request/response traffic) constructs its
// OWN separate `NDKPool` in its constructor — not the main app's
// `ndk.pool`. That matters because this project already found and
// fixed, the hard way, a real defect in NDK's own built-in relay-
// reconnect scheduler (see relayStatus.ts's own top comment): detection
// of a dropped connection works, but the retry it schedules never
// actually fires. relayStatus.ts's fix (a manual periodic retry,
// checking `relay.connected` directly rather than trusting the
// `relay:ready` event alone) was scoped to the main pool only — the
// NIP-46 RPC pool never got the same treatment, so a dropped connection
// to it could leave bunker responses silently undeliverable forever,
// with the main app's own connection-status pill showing fully healthy
// throughout (it only reflects the separately-patched main pool).
//
// A second, real subtlety found while building this fix, not assumed:
// reconnecting the underlying WebSocket isn't sufficient on its own.
// `NDKNip46Signer`'s own `switchRelays()` method (triggered when a
// bunker asks the client to move to different relays) demonstrates the
// NDK-sanctioned way to force a fresh subscription:
// `this.subscription?.stop(); this.subscription = undefined; await
// this.startListening()` — because a subscription that was already
// RUNNING when the relay dropped is never automatically re-sent once
// the relay reconnects (the same "generation counter" problem
// relayStatus.ts's own hooks solve for the main pool, just with no
// React-hook consumer to hang a dependency array off here). This
// module reuses that exact NDK-internal pattern directly, rather than
// inventing a new one.
const RETRY_INTERVAL_MS = 3000

interface SignerInternals {
  subscription?: NDKSubscription
  startListening: () => Promise<void>
}

// TypeScript's `private` on NDKNostrRpc.pool and NDKNip46Signer's own
// subscription/startListening is compile-time only — same runtime-only-
// encapsulation reasoning already applied elsewhere in this codebase
// (remoteSigner.ts's own _user reach-through, documented there).
function getRpcPool(signer: NDKNip46Signer): NDKPool | undefined {
  return (signer.rpc as unknown as { pool?: NDKPool }).pool
}

function getSignerInternals(signer: NDKNip46Signer): SignerInternals {
  return signer as unknown as SignerInternals
}

// Watches a connected NIP-46 signer's own dedicated relay pool and
// applies relayStatus.ts's proven manual-reconnect-with-backoff pattern
// to it, plus a forced resubscribe once a relay genuinely recovers.
// Returns a cleanup function — call it when the signer disconnects or
// gets replaced (switching identities, logging off, connecting a
// different bunker), so a stale watcher never fires against a pool
// that's no longer in use.
export function watchNip46RpcReconnect(signer: NDKNip46Signer): () => void {
  const pool = getRpcPool(signer)
  if (!pool) return () => {}

  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let stopped = false

  function resubscribe() {
    const internals = getSignerInternals(signer)
    internals.subscription?.stop()
    internals.subscription = undefined
    internals.startListening().catch(() => {
      // Swallow — if this genuinely fails, the next disconnect/retry
      // cycle (or the user reconnecting manually) will try again.
    })
  }

  function markRecovered(relay: NDKRelay) {
    const timer = retryTimers.get(relay.url)
    if (timer) {
      clearTimeout(timer)
      retryTimers.delete(relay.url)
    }
    resubscribe()
  }

  function scheduleRetry(relay: NDKRelay) {
    if (stopped || retryTimers.has(relay.url)) return
    const timer = setTimeout(async () => {
      retryTimers.delete(relay.url)
      if (stopped) return
      if (!relay.connected) {
        try {
          await relay.connect()
        } catch {
          // Swallow — checked directly below regardless of outcome.
        }
      }
      if (relay.connected) markRecovered(relay)
      else scheduleRetry(relay)
    }, RETRY_INTERVAL_MS)
    retryTimers.set(relay.url, timer)
  }

  function onDisconnect(relay: NDKRelay) {
    scheduleRetry(relay)
  }

  // Kept as a harmless, redundant second path — relayStatus.ts's own
  // live testing found `relay:ready` doesn't reliably re-fire for a
  // relay that's already been through one disconnect/reconnect cycle,
  // which is why the retry loop above checks `relay.connected` directly
  // rather than depending on this alone.
  function onReady(relay: NDKRelay) {
    markRecovered(relay)
  }

  pool.on('relay:disconnect', onDisconnect)
  pool.on('relay:ready', onReady)

  return function stop() {
    stopped = true
    pool.off('relay:disconnect', onDisconnect)
    pool.off('relay:ready', onReady)
    for (const timer of retryTimers.values()) clearTimeout(timer)
    retryTimers.clear()
  }
}
