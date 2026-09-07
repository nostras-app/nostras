import { useSyncExternalStore } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

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
// filtered queries — but a follower list is a backlog of already-
// published kind:3 events, not something that needs to keep streaming
// forever for a small decorative count next to a name. Closes on EOSE or
// a 6s timeout, whichever comes first.
//
// Same honest scope limitation as useFollowCounts.ts's own followers
// count: only reflects what's visible across the relays currently in the
// pool, not the whole network.
//
// Not wired into relayStatus.ts's generation-recovery retry (unlike
// useProfile.ts/useReferencedNote.ts/useBadgeDefinition.ts/
// useShowMeta.ts) — deliberately, not an oversight: those cache
// `T | null` and can tell "genuinely resolved" apart from "the fetch
// failed," so clearing only the failed entries is safe. This hook caches
// a plain `number`, where 0 is a legitimate real answer indistinguishable
// from "nothing came back before the timeout" — retrying on every relay
// reconnect would risk needlessly re-querying a pubkey that already has a
// real, correct zero.
const cache = new Map<string, number>()
const inFlight = new Set<string>()
const listeners = new Set<() => void>()

const COUNT_TIMEOUT_MS = 6000

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

  const seen = new Set<string>()
  let settled = false
  const sub = ndk.subscribe({ kinds: [3], '#p': [pubkey] }, { closeOnEose: false })

  const finish = () => {
    if (settled) return
    settled = true
    sub.stop()
    cache.set(pubkey, seen.size)
    inFlight.delete(pubkey)
    notify()
  }

  // Deduplicated by author (not event id) since kind:3 is replaceable —
  // an author republishing their list shouldn't double-count, matching
  // useFollowCounts.ts's own identical reasoning.
  sub.on('event', (event: NDKEvent) => seen.add(event.pubkey))
  sub.on('eose', finish)
  setTimeout(finish, COUNT_TIMEOUT_MS)
}

export function useFollowerCount(pubkey: string | undefined): number | null {
  return useSyncExternalStore(subscribe, () => {
    if (!pubkey) return null
    ensureFetched(pubkey)
    return cache.get(pubkey) ?? null
  })
}
