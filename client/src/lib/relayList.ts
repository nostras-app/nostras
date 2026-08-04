import { NDKRelayStatus } from '@nostr-dev-kit/ndk'
import { ndk } from './ndk'

export interface RelayInfo {
  url: string
  connected: boolean
  status: NDKRelayStatus
}

// Same module-level-cache + notify pattern as relayStatus.ts / useProfile:
// useSyncExternalStore needs a stable snapshot reference between real
// changes, so this is recomputed only when the pool actually tells us
// something changed, not on every render.
let snapshot: RelayInfo[] = computeSnapshot()
const listeners = new Set<() => void>()

function computeSnapshot(): RelayInfo[] {
  return Array.from(ndk.pool.relays.values()).map((relay) => ({
    url: relay.url,
    connected: relay.connected,
    status: relay.status,
  }))
}

function refresh() {
  snapshot = computeSnapshot()
  for (const listener of listeners) listener()
}

const POOL_EVENTS = [
  'relay:connecting',
  'relay:connect',
  'relay:ready',
  'relay:disconnect',
  'relay:auth',
  'relay:authed',
] as const

for (const event of POOL_EVENTS) {
  ndk.pool.on(event, refresh)
}

export function subscribeRelayList(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRelayListSnapshot(): RelayInfo[] {
  return snapshot
}

export function relayStatusLabel(status: NDKRelayStatus): string {
  switch (status) {
    case NDKRelayStatus.CONNECTED:
    case NDKRelayStatus.AUTHENTICATED:
      return 'connected'
    case NDKRelayStatus.CONNECTING:
    case NDKRelayStatus.RECONNECTING:
    case NDKRelayStatus.AUTH_REQUESTED:
    case NDKRelayStatus.AUTHENTICATING:
      return 'connecting'
    case NDKRelayStatus.FLAPPING:
      return 'flapping'
    case NDKRelayStatus.DISCONNECTING:
    case NDKRelayStatus.DISCONNECTED:
    default:
      return 'disconnected'
  }
}
