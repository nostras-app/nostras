import { useSyncExternalStore } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, authorQueryRelaySet } from '../lib/ndk'

// Module-level cache shared across every component, same
// useSyncExternalStore pattern as useProfile.ts — a Following/Followers
// modal can show many pubkeys at once, and this keeps it to one bounded
// lookup per pubkey per session regardless of how many rows render it,
// rather than every row opening its own live, never-closing subscription
// (the exact "duplicate subscription per row" mistake this project has
// already hit once, in the DM conversation list).
//
// Deliberately a bounded one-shot lookup, not a live-updating count: tag-
// filtered (`#p`, not `authors`), so this never hits the CONNECTED-only
// relay race useFollowCounts.ts's own comment documents for authors-
// filtered queries.
//
// Real, reported bug (2026-09-08): a genuinely popular pubkey (Derek
// Ross) showed a wildly undercounted "165 followers" — this wasn't a
// "just needs more time" problem. Confirmed directly: a raw 20s `nak`
// query against the exact same three relays this hook queries never
// even reached EOSE and had already found 528 distinct followers with
// more still streaming in. No `limit` on the filter meant a genuinely
// unbounded fetch for a popular account — bumping the timeout would
// have only shifted the undercount higher, not fixed it, and would have
// meant every row in a big Following list opening its own long-running
// subscription simultaneously (a real relay/client load concern this
// project has already been burned by once, for the connection-count
// near-OOM incidents documented in this repo's own history). Fixed by
// capping the query at FOLLOWER_COUNT_LIMIT and being honest about a
// truncated result (`500+`) rather than presenting a capped count as
// exact — same "don't claim more precision than the data actually has"
// principle as this app's own new-notes-pill truncation label.
const FOLLOWER_COUNT_LIMIT = 500
const COUNT_TIMEOUT_MS = 12000
// Real, confirmed cause of a second, deeper undercount left even after
// scoping to authorQueryRelaySet and adding a limit (2026-09-08): a big
// Following list (687 real rows here) mounts every row at once, and each
// one calls this hook on mount — with no concurrency limit, that's 687
// simultaneous subscriptions competing for the same 3 relays' attention,
// so even a query that converges in ~6s in isolation (verified directly
// via a clean single `nak` request) barely reached 200 in 8s+ once thrown
// in with hundreds of siblings. This queue caps how many of these run at
// once, letting each one actually get a real share of bandwidth/relay
// attention instead of all of them starving each other equally.
const MAX_CONCURRENT_LOOKUPS = 6
const queue: string[] = []
let activeCount = 0

export type FollowerCountResult = { count: number; truncated: boolean }

const cache = new Map<string, FollowerCountResult>()
const inFlight = new Set<string>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function runNext() {
  if (activeCount >= MAX_CONCURRENT_LOOKUPS) return
  const pubkey = queue.shift()
  if (!pubkey) return
  activeCount++
  fetchOne(pubkey, () => {
    activeCount--
    runNext()
  })
}

function ensureFetched(pubkey: string) {
  if (cache.has(pubkey) || inFlight.has(pubkey) || queue.includes(pubkey)) return
  queue.push(pubkey)
  runNext()
}

function fetchOne(pubkey: string, onDone: () => void) {
  inFlight.add(pubkey)

  const seen = new Set<string>()
  let settled = false
  // Explicitly scoped to authorQueryRelaySet (the same 3 known-fast
  // relays used throughout this app for exactly this class of concern) —
  // real, confirmed cause of the same reported undercount: an unscoped
  // subscribe() queries whatever's in the live pool at that moment,
  // which can include far more relays than these 3 (outbox-discovered
  // ones, stale custom relays left over in a long-lived session) and
  // measurably slows convergence within a bounded window. Verified
  // directly: these exact 3 relays return a full 500-event limited
  // query in under 6s; the unscoped pool took 8s+ to reach only 206.
  const sub = ndk.subscribe(
    { kinds: [3], '#p': [pubkey], limit: FOLLOWER_COUNT_LIMIT },
    { closeOnEose: false, relaySet: authorQueryRelaySet },
  )

  const finish = () => {
    if (settled) return
    settled = true
    sub.stop()
    // Hitting the limit exactly doesn't prove there are more (the true
    // count could coincidentally be exactly the limit), but treating it
    // as "at least this many, possibly more" is the honest reading —
    // the alternative (silently presenting it as exact) is what
    // produced the wrong "165" in the first place.
    cache.set(pubkey, { count: seen.size, truncated: seen.size >= FOLLOWER_COUNT_LIMIT })
    inFlight.delete(pubkey)
    notify()
    onDone()
  }

  // Deduplicated by author (not event id) since kind:3 is replaceable —
  // an author republishing their list shouldn't double-count, matching
  // useFollowCounts.ts's own identical reasoning.
  sub.on('event', (event: NDKEvent) => seen.add(event.pubkey))
  sub.on('eose', finish)
  setTimeout(finish, COUNT_TIMEOUT_MS)
}

// Same honest scope limitation as useFollowCounts.ts's own followers
// count: only reflects what's visible across the relays currently in
// the pool, not the whole network — now doubly true once a result is
// truncated at the limit, which the caller should surface plainly
// (e.g. "500+ followers") rather than presenting as precise.
//
// Not wired into relayStatus.ts's generation-recovery retry (unlike
// useProfile.ts/useReferencedNote.ts/useBadgeDefinition.ts/
// useShowMeta.ts) — deliberately, not an oversight: those cache
// `T | null` and can tell "genuinely resolved" apart from "the fetch
// failed," so clearing only the failed entries is safe. This hook
// always caches a real result object once settled (never null), and a
// count of 0 is itself a legitimate real answer indistinguishable from
// "nothing came back before the timeout" — retrying on every relay
// reconnect would risk needlessly re-querying a pubkey that already has
// a real, correct zero.
export function useFollowerCount(pubkey: string | undefined): FollowerCountResult | null {
  return useSyncExternalStore(subscribe, () => {
    if (!pubkey) return null
    ensureFetched(pubkey)
    return cache.get(pubkey) ?? null
  })
}
