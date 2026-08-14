import { useSyncExternalStore } from 'react'
import { fetchShowMetaTags, parseShowMeta, type ShowMeta } from '../lib/podcast'

// Module-level cache shared across all components, same
// useSyncExternalStore pattern as useProfile.ts — an episode feed can
// show many episodes from the same show, and this avoids a redundant
// fetch per card for the identical pubkey.
const cache = new Map<string, ShowMeta | null>()
const inFlight = new Set<string>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function ensureFetched(pubkey: string) {
  if (cache.has(pubkey) || inFlight.has(pubkey)) return
  inFlight.add(pubkey)
  fetchShowMetaTags(pubkey).then((tags) => {
    cache.set(pubkey, tags ? parseShowMeta(tags) : null)
    inFlight.delete(pubkey)
    notify()
  })
}

// Read-only show metadata for a given pubkey — null means either "no
// show metadata published" or "couldn't be fetched," treated the same
// (an episode card degrades to showing just the episode's own
// title/image, no show byline, rather than erroring).
export function useShowMeta(pubkey: string | undefined): ShowMeta | null {
  return useSyncExternalStore(subscribe, () => {
    if (!pubkey) return null
    ensureFetched(pubkey)
    return cache.get(pubkey) ?? null
  })
}
