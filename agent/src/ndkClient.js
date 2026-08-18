// Polyfill BEFORE importing NDK — verified there is no `webSocketImpl`
// constructor option in this NDK version (checked against the installed
// 3.0.3 type defs and compiled source: relay connectivity code does a
// bare `new WebSocket(url)` against the global, exactly like a browser
// provides implicitly). This import order matters: NDK's module graph
// must not be evaluated before the global exists.
import { WebSocket } from 'ws'
globalThis.WebSocket = WebSocket

import NDK, { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { makeRelayConnectionFilter } from './relayFilter.js'

// Same set authorQueryRelaySet already uses in client/src/lib/ndk.ts, for
// the same reason: redundant, already-proven-reliable relays rather than
// depending on a single one.
export const NOSTRAS_RELAY_URL = 'wss://nostras.app'
export const LISTEN_RELAY_URLS = [
  NOSTRAS_RELAY_URL,
  'wss://relay.damus.io',
  'wss://relay.primal.net',
]

const isAllowedRelayUrl = makeRelayConnectionFilter(NOSTRAS_RELAY_URL)

export function buildNdk(signer) {
  const ndk = new NDK({
    explicitRelayUrls: LISTEN_RELAY_URLS,
    signer,
    relayConnectionFilter: isAllowedRelayUrl,
  })

  // Some DM relays require NIP-42 auth (a real one hit this project
  // already: wss://auth.nostr1.com, a real recipient's kind:10050 relay).
  // Deliberately a plain `true` policy, not NDKRelayAuthPolicies.signIn —
  // that helper was found to hang/never complete in this NDK version (see
  // client/src/lib/ndk.ts's own comment on the same finding).
  ndk.relayAuthDefaultPolicy = async () => true

  return ndk
}

export function relaySetFromUrls(ndk, urls) {
  const allowed = urls.filter(isAllowedRelayUrl)
  return NDKRelaySet.fromRelayUrls(allowed, ndk)
}

export { isAllowedRelayUrl }
