import { useSyncExternalStore } from 'react'
import { subscribePublishTargets, getPublishTargetsSnapshot } from '../lib/publishTargets'

export function usePublishTargets(): Set<string> {
  return useSyncExternalStore(subscribePublishTargets, getPublishTargetsSnapshot)
}
