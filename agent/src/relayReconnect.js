import { normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import { LISTEN_RELAY_URLS } from './ndkClient.js'
import { log } from './logger.js'

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000
const STABLE_RESET_THRESHOLD_MS = 60000
const CHECK_INTERVAL_MS = 1000

// Backoff shape ported from server/cmd/dvm/main.go's already-proven
// reconnect loop (1s initial, doubling, capped at 30s, reset to 1s once a
// connection has stayed up over a minute).
//
// Deliberately scoped ONLY to this daemon's fixed LISTEN_RELAY_URLS, not
// ndk.pool.relays wholesale — confirmed live, not hypothetical: an
// earlier version iterating the whole pool picked up 24 distinct relay
// URLs after a single reply round-trip, because dmOutbox.js's
// discoverRecipientDmRelays (looking up the owner's real kind:10050/10002
// list) adds every discovered relay into the shared pool as a normal
// side effect of NDKRelaySet.fromRelayUrls(), and that pool is genuinely
// dynamic (same already-documented NDK behavior client/src/lib/relayList.ts
// notes for the browser client). This daemon has no reason to actively
// monitor/reconnect relays it only ever touches for one-off discovery or
// a single reply publish.
//
// Also deliberately does NOT trust NDK's own automatic reconnect
// scheduler — client/src/lib/relayStatus.ts already found that
// unreliable in production for this exact library (a real, live-observed
// incident, not theoretical): checks relay.connected directly on an
// interval and retries connect() itself, rather than waiting on a
// 'ready' event alone.
//
// onRecovery(url) fires on a disconnected -> connected TRANSITION only
// (never the initial connect) — this is what lets index.js tear down and
// reissue dmInbox's subscription on that relay, closing a real gap found
// live: NDK does not automatically resend an existing subscription's REQ
// to a relay that reconnects after a drop, so a message published during
// the gap is silently never delivered to an already-open subscription
// (same root cause this project already fixed once for
// useNoteFeed.ts/useNotifications.ts via a "generation" counter).
export function startReconnectLoop(ndk, onRecovery) {
  const normalizedListenUrls = LISTEN_RELAY_URLS.map((u) => normalizeRelayUrl(u))
  const relayState = new Map()

  function stateFor(url) {
    if (!relayState.has(url)) {
      relayState.set(url, {
        backoffMs: INITIAL_BACKOFF_MS,
        nextAttemptAt: 0,
        connectedAt: null,
        everConnected: false,
      })
    }
    return relayState.get(url)
  }

  const interval = setInterval(() => {
    const now = Date.now()
    for (const url of normalizedListenUrls) {
      const relay = ndk.pool.relays.get(url)
      if (!relay) continue // not yet registered in the pool — shouldn't normally happen after initial connect

      const s = stateFor(url)

      if (relay.connected) {
        if (s.connectedAt === null) {
          const isRecovery = s.everConnected
          s.connectedAt = now
          s.everConnected = true
          log.info('Relay connected', { url })
          if (isRecovery && onRecovery) {
            try {
              onRecovery(url)
            } catch (e) {
              log.error('onRecovery handler threw', { error: e instanceof Error ? e.message : String(e) })
            }
          }
        }
        if (now - s.connectedAt > STABLE_RESET_THRESHOLD_MS) {
          s.backoffMs = INITIAL_BACKOFF_MS
        }
        continue
      }

      if (s.connectedAt !== null) {
        log.warn('Relay disconnected', { url })
      }
      s.connectedAt = null

      if (now < s.nextAttemptAt) continue

      s.nextAttemptAt = now + s.backoffMs
      const thisBackoff = s.backoffMs
      s.backoffMs = Math.min(s.backoffMs * 2, MAX_BACKOFF_MS)
      log.info('Retrying relay connection', { url, backoffMs: thisBackoff })
      relay.connect().catch((e) => {
        log.warn('Relay reconnect attempt failed', {
          url,
          error: e instanceof Error ? e.message : String(e),
        })
      })
    }
  }, CHECK_INTERVAL_MS)

  return () => clearInterval(interval)
}
