import { useSyncExternalStore } from 'react'
import {
  subscribeRelayStatus,
  getRelayStatus,
  getRelayGeneration,
  type LocalRelayStatus,
} from '../lib/relayStatus'

// status: for UI (e.g. the header pill). generation: for subscription
// hooks to depend on so they recreate their subscription after the local
// relay recovers from a disconnect — see lib/relayStatus.ts for why NDK's
// own reconnection logic isn't enough on its own.
export function useRelayStatus(): { status: LocalRelayStatus; generation: number } {
  const status = useSyncExternalStore(subscribeRelayStatus, getRelayStatus)
  const generation = useSyncExternalStore(subscribeRelayStatus, getRelayGeneration)
  return { status, generation }
}
