import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

// Following: this pubkey's own kind:3 contact list, counted by its 'p'
// tags. Followers: every kind:3 event anywhere in the pool that tags this
// pubkey, deduplicated by author (not event id) since kind:3 is
// replaceable — an author republishing their list shouldn't double-count.
// Also exposes the actual pubkey lists (not just counts) for
// FollowListModal — this hook was already doing the underlying fetch/
// subscribe work, so surfacing the lists it already has is free; no
// second parallel query when the modal opens.
//
// Honest limitation, not a bug: this only reflects what's visible across
// the relays currently in the pool, not the whole network — there's no
// single index of "everyone who follows this pubkey" without a dedicated
// aggregator. Treated the same way as the "seen on N relays" and NIP-50
// search scope captions elsewhere in this app: real data, honestly scoped,
// not presented as more precise than it is.
export function useFollowCounts(pubkey: string | undefined) {
  const [followingPubkeys, setFollowingPubkeys] = useState<string[] | null>(null)
  const [followerPubkeys, setFollowerPubkeys] = useState<string[]>([])

  useEffect(() => {
    if (!pubkey) {
      setFollowingPubkeys(null)
      return
    }

    let cancelled = false
    setFollowingPubkeys(null)

    ndk.fetchEvent({ kinds: [3], authors: [pubkey] }).then((event) => {
      if (cancelled) return
      const pubkeys = (event?.tags ?? [])
        .filter((t) => t[0] === 'p' && !!t[1])
        .map((t) => t[1])
      setFollowingPubkeys(pubkeys)
    })

    return () => {
      cancelled = true
    }
  }, [pubkey])

  useEffect(() => {
    if (!pubkey) return

    setFollowerPubkeys([])
    const seen = new Set<string>()
    const sub = ndk.subscribe({ kinds: [3], '#p': [pubkey] })

    sub.on('event', (event: NDKEvent) => {
      if (seen.has(event.pubkey)) return
      seen.add(event.pubkey)
      setFollowerPubkeys(Array.from(seen))
    })

    return () => sub.stop()
  }, [pubkey])

  return {
    following: followingPubkeys?.length ?? null,
    followers: followerPubkeys.length,
    followingPubkeys: followingPubkeys ?? [],
    followerPubkeys,
  }
}
