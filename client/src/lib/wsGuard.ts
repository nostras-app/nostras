// Installs a hard guard on the global WebSocket constructor. MUST be the
// first import in main.tsx, so it's in place before any other app code
// (including lib/ndk.ts's `new NDK(...)`) ever runs.
//
// Why this exists in addition to relayConnectionFilter (lib/ndk.ts): that
// filter only gates whether a relay gets registered into ndk.pool.relays.
// Traced through the installed NDK version's (3.0.3) own source and found
// it does NOT actually stop a connection attempt in every case —
// NDKPool.getRelay(url, true, true) (the exact call NDK's own internal
// outbox-relay-resolution logic uses to reach relays discovered from OTHER
// users' NIP-65/NIP-51 lists during normal subscribe/fetch calls, not just
// the DM-relay-discovery path this project fixed earlier) constructs and
// *returns* the NDKRelay object unconditionally, even when
// relayConnectionFilter refuses to add it to the pool. The calling code
// still holds a live NDKRelay object and can call .connect() on it
// directly — bypassing the filter entirely. Confirmed by reading
// node_modules/@nostr-dev-kit/ndk/dist/index.js directly, not assumed:
// `addRelay()` checks the filter and returns early, but `useTemporaryRelay()`
// and `fromRelayUrls()` never check addRelay's outcome before proceeding.
// This is a real, confirmed gap in the library, not a hypothetical — and
// it's the actual explanation for why "Not Secure" (Chrome's Local Network
// Access protection, triggered by an outbox-discovered private-IP relay
// like ws://127.0.0.1:.../) kept recurring across fresh browser profiles
// even after the earlier relayConnectionFilter fix shipped.
//
// Blocking at the actual network boundary (the WebSocket constructor
// itself) closes this regardless of which internal NDK code path
// constructed the relay — current or future, not just the ones audited
// today. NDK's own NDKRelayConnectivity already wraps `new WebSocket(url)`
// in a try/catch and treats a thrown error exactly like a normal failed
// connection (logs via its own debug channel, marks the relay
// DISCONNECTED, the pool's own .catch() absorbs the rejection) — so
// throwing here is the library's own intended way to refuse a connection,
// not a crash risk.
import { isPrivateOrLocalHostname } from './relayFilter'

// Must match lib/ndk.ts's localRelayUrl computation. Duplicated rather than
// imported so this module has zero dependency on ndk.ts and can safely be
// evaluated first, before ndk.ts's own top-level `new NDK(...)` call.
const allowedLocalRelayUrl = import.meta.env.VITE_RELAY_URL || 'ws://localhost:7777'

let allowedHost: string | null = null
try {
  const u = new URL(allowedLocalRelayUrl)
  allowedHost = `${u.hostname}:${u.port}`
} catch {
  allowedHost = null
}

const NativeWebSocket = window.WebSocket

class GuardedWebSocket extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    const parsed = typeof url === 'string' ? new URL(url) : url
    const isBlocked =
      isPrivateOrLocalHostname(parsed.hostname) && `${parsed.hostname}:${parsed.port}` !== allowedHost
    if (isBlocked) {
      console.warn(`[wsGuard] Blocked WebSocket connection to private/local address: ${parsed.href}`)
      throw new DOMException(`Blocked WebSocket connection to private/local address: ${parsed.hostname}`, 'SecurityError')
    }
    super(url, protocols)
  }
}

window.WebSocket = GuardedWebSocket as unknown as typeof WebSocket
