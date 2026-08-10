import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

// Count of events of a given kind tagging eventId via #e — used for reply
// (kind 1) counts on a note. Deliberately event-based, not person-based:
// two separate replies from the same author are two distinct comments,
// correctly counted as 2.
export function useEventCount(eventId: string, kind: number): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    setCount(0)
    const seen = new Set<string>()
    const sub = ndk.subscribe({ kinds: [kind], '#e': [eventId] })

    sub.on('event', (event: NDKEvent) => {
      if (seen.has(event.id)) return
      seen.add(event.id)
      setCount(seen.size)
    })

    return () => sub.stop()
  }, [eventId, kind])

  return count
}

// List of distinct pubkeys who reacted to eventId with a given kind — used
// for like (7) and repost (6). Unlike useEventCount above, this dedupes by
// AUTHOR, not by event id: reacting twice isn't "2 likes" from a reader's
// perspective the way two separate replies are two distinct comments, and
// showing the same person's avatar twice in a "who liked this" list would
// just be confusing. Powers both the engagement bar's own count display
// (so it always matches what the list modal shows) and the modal itself.
export function useReactionList(eventId: string, kind: number): { count: number; pubkeys: string[] } {
  const [pubkeys, setPubkeys] = useState<string[]>([])

  useEffect(() => {
    setPubkeys([])
    const seenPubkeys = new Set<string>()
    const sub = ndk.subscribe({ kinds: [kind], '#e': [eventId] })

    sub.on('event', (event: NDKEvent) => {
      if (seenPubkeys.has(event.pubkey)) return
      seenPubkeys.add(event.pubkey)
      setPubkeys((prev) => [...prev, event.pubkey])
    })

    return () => sub.stop()
  }, [eventId, kind])

  return { count: pubkeys.length, pubkeys }
}
