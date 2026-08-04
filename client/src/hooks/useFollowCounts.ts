import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

// Following: this pubkey's own kind:3 contact list, counted by its 'p'
// tags. Followers: every kind:3 event anywhere in the pool that tags this
// pubkey, deduplicated by author (not event id) since kind:3 is
// replaceable — an author republishing their list shouldn't double-count.
//
// Honest limitation, not a bug: this only reflects what's visible across
// the relays currently in the pool, not the whole network — there's no
// single index of "everyone who follows this pubkey" without a dedicated
// aggregator. Treated the same way as the "seen on N relays" and NIP-50
// search scope captions elsewhere in this app: real data, honestly scoped,
// not presented as more precise than it is.
export function useFollowCounts(pubkey: string | undefined) {
  const [following, setFollowing] = useState<number | null>(null)
  const [followers, setFollowers] = useState<number | null>(null)

  useEffect(() => {
    if (!pubkey) {
      setFollowing(null)
      setFollowers(null)
      return
    }

    let cancelled = false
    setFollowing(null)

    ndk.fetchEvent({ kinds: [3], authors: [pubkey] }).then((event) => {
      if (cancelled || !event) return
      setFollowing(event.tags.filter((t) => t[0] === 'p').length)
    })

    return () => {
      cancelled = true
    }
  }, [pubkey])

  useEffect(() => {
    if (!pubkey) return

    setFollowers(0)
    const authors = new Set<string>()
    const sub = ndk.subscribe({ kinds: [3], '#p': [pubkey] })

    sub.on('event', (event: NDKEvent) => {
      if (authors.has(event.pubkey)) return
      authors.add(event.pubkey)
      setFollowers(authors.size)
    })

    return () => sub.stop()
  }, [pubkey])

  return { following, followers }
}
