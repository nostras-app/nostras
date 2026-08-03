import { useSyncExternalStore } from 'react'
import type { NDKUserProfile } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

// Module-level cache shared across all components so the same pubkey is
// never fetched more than once per session, and every subscriber re-renders
// when a profile is fetched or updated (e.g. after ProfileEditor saves).
const cache = new Map<string, NDKUserProfile | null>()
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
  ndk
    .getUser({ pubkey })
    .fetchProfile()
    .then((profile) => {
      cache.set(pubkey, profile)
      inFlight.delete(pubkey)
      notify()
    })
}

export function setCachedProfile(pubkey: string, profile: NDKUserProfile) {
  cache.set(pubkey, profile)
  notify()
}

export function useProfile(pubkey: string | undefined): NDKUserProfile | null {
  return useSyncExternalStore(subscribe, () => {
    if (!pubkey) return null
    ensureFetched(pubkey)
    return cache.get(pubkey) ?? null
  })
}
