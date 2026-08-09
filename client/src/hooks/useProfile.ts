import { useSyncExternalStore } from 'react'
import type { NDKUserProfile } from '@nostr-dev-kit/ndk'
import { ndk, authorQueryRelaySet } from '../lib/ndk'

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
  // NDKUser.fetchProfile() internally does an unscoped
  // ndk.fetchEvent({kinds:[0], authors:[pubkey]}) with no relay set —
  // same bug class as useFollowing/useFollowCounts/useNoteFeed (see
  // authorQueryRelaySet's comment in lib/ndk.ts). Its own `opts` param
  // doesn't have a documented relaySet field, but NDK's fetchEvent()
  // spreads opts into its internal subscribeOpts before checking the
  // (here-unused) third positional relaySet argument, so opts.relaySet
  // still flows through — confirmed by reading NDK's own source, not
  // guessed. Without this, a profile view for anyone not already on our
  // own relay could show "Anonymous" / no avatar for longer than
  // necessary while the slower single-relay outbox path was still the
  // only source.
  ndk
    .getUser({ pubkey })
    .fetchProfile({ relaySet: authorQueryRelaySet })
    .then((profile) => {
      cache.set(pubkey, profile)
      inFlight.delete(pubkey)
      notify()
    })
    .catch(() => {
      // Never leave inFlight permanently set on a rejection — without
      // this, a single failed fetch would silently block that pubkey
      // from ever being retried for the rest of the session (ensureFetched
      // refuses to re-run while inFlight.has(pubkey) is true).
      inFlight.delete(pubkey)
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
