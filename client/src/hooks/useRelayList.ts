import { useSyncExternalStore } from 'react'
import { subscribeRelayList, getRelayListSnapshot, type RelayInfo } from '../lib/relayList'

export function useRelayList(): RelayInfo[] {
  return useSyncExternalStore(subscribeRelayList, getRelayListSnapshot)
}
