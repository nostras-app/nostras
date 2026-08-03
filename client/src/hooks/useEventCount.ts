import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

// Count of events of a given kind tagging eventId via #e — used for like
// (kind 7), repost (kind 6), and reply (kind 1) counts on a note.
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
