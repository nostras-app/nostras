import { useSyncExternalStore } from 'react'
import { authorQueryRelaySet } from '../lib/ndk'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'
import { KIND_PROFILE_BADGES, parseProfileBadgeTags, type ProfileBadgeEntry } from '../lib/badges'

// Read-only: any pubkey's accepted, ordered badge display list
// (kind:10008), for rendering on a profile (own or someone else's).
// Shown as the profile owner's own claim, not independently re-verified
// (same posture as NIP-39 linked accounts).
//
// Real bug (2026-09-26, user-reported: "I clicked add to my profile, but
// the profile doesn't show it"): this used to be per-component state
// fetched once per pubkey. Every view stays mounted, so the own-profile
// row fetched the badge list at boot — before the badge was accepted —
// and never refetched; accepting in Settings (useMyProfileBadges, its own
// separate state) never reached it. Same bug class and same fix as
// useMuteList.ts: a module-level cache shared by every consumer, which
// useMyProfileBadges writes into on every successful publish.
const cache = new Map<string, ProfileBadgeEntry[]>()
const inFlight = new Set<string>()
const listeners = new Set<() => void>()
const EMPTY: ProfileBadgeEntry[] = []

function notify() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function ensureFetched(pubkey: string) {
  if (cache.has(pubkey) || inFlight.has(pubkey)) return
  inFlight.add(pubkey)
  // fetchLatestReplaceableEvent, not ndk.fetchEvent() — see that
  // function's own comment (stale-relay EOSE-convergence race).
  fetchLatestReplaceableEvent({ kinds: [KIND_PROFILE_BADGES], authors: [pubkey] }, authorQueryRelaySet)
    .then((event) => {
      // Don't clobber a value written by setCachedProfileBadges while
      // this fetch was in flight (the user's own accept/remove is newer).
      if (!cache.has(pubkey)) cache.set(pubkey, event ? parseProfileBadgeTags(event.tags) : [])
      notify()
    })
    .catch(() => {})
    .finally(() => inFlight.delete(pubkey))
}

// Called by useMyProfileBadges after a successful publish, so the user's
// own profile row updates immediately instead of on the next reload.
export function setCachedProfileBadges(pubkey: string, entries: ProfileBadgeEntry[]) {
  cache.set(pubkey, entries)
  notify()
}

export function useProfileBadges(pubkey: string | undefined): ProfileBadgeEntry[] {
  return useSyncExternalStore(subscribe, () => {
    if (!pubkey) return EMPTY
    ensureFetched(pubkey)
    return cache.get(pubkey) ?? EMPTY
  })
}
