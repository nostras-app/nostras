import { useSyncExternalStore } from 'react'
import { profileFromEvent, type NDKUserProfile } from '@nostr-dev-kit/ndk'
import { authorQueryRelaySet } from '../lib/ndk'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'

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
  // NDKUser.fetchProfile() internally does an authors-filtered
  // ndk.fetchEvent({kinds:[0], authors:[pubkey]}, opts) — its own `opts`
  // param doesn't have a documented relaySet field, but NDK's
  // fetchEvent() spreads opts into its internal subscribeOpts before
  // checking the (here-unused) third positional relaySet argument, so
  // opts.relaySet did flow through when this passed
  // {relaySet: authorQueryRelaySet} directly to fetchProfile(). That
  // fixed the original unscoped-CONNECTED-only-fallback bug (see
  // authorQueryRelaySet's own comment in lib/ndk.ts) but not a second,
  // narrower one: fetchEvent() *also* unconditionally hardcodes
  // closeOnEose:true (confirmed in NDK's own source — applied after
  // spreading opts, so a caller's own value is always overwritten),
  // which can let its EOSE-convergence heuristic resolve on a stale
  // relay's copy of this replaceable kind:0 event before a slower
  // relay's genuinely newer one arrives — the same race found and fixed
  // for useFollowing.ts/useFollowCounts.ts (2026-08-17, see that dated
  // CLAUDE.md entry). fetchProfile() has no way to opt out of
  // closeOnEose, so this bypasses it entirely: fetches the raw event via
  // fetchLatestReplaceableEvent (which never uses closeOnEose/eose at
  // all) and parses it with NDK's own exported profileFromEvent() —
  // the exact same parsing fetchProfile() itself uses internally, kept
  // in sync by construction rather than hand-rolled.
  fetchLatestReplaceableEvent({ kinds: [0], authors: [pubkey] }, authorQueryRelaySet)
    .then((event) => {
      const profile = event ? profileFromEvent(event) : null
      cache.set(pubkey, profile)
      inFlight.delete(pubkey)
      notify()
    })
    .catch(() => {
      // Never leave inFlight permanently set on a rejection — without
      // this, a single failed fetch would silently block that pubkey
      // from ever being retried for the rest of the session (ensureFetched
      // refuses to re-run while inFlight.has(pubkey) is true).
      // fetchLatestReplaceableEvent itself never rejects, but
      // profileFromEvent() can throw on unparseable JSON content, so
      // this stays as a real safety net, not dead code.
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
