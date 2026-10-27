import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { getReplyToEventId } from '../lib/nip10'

// A plain `#e` filter on kind:1 catches every note that references this
// id, not just direct replies: quotes ("mention") and replies further
// down the thread (which tag this note as "root") match too. Keep only
// notes whose NIP-10 parent is this note.
function isReplyTo(event: NDKEvent, eventId: string): boolean {
  return getReplyToEventId(event.tags) === eventId
}

// Direct replies to a note, oldest first (natural thread reading order).
// Used by SingleNoteView to show a real threaded view instead of just a
// count — closes a previously-documented gap ("no threaded display of
// actual replies yet, just a count").
export function useReplies(eventId: string): NDKEvent[] {
  const [replies, setReplies] = useState<NDKEvent[]>([])

  useEffect(() => {
    setReplies([])
    const seen = new Set<string>()
    const sub = ndk.subscribe({ kinds: [1], '#e': [eventId] })

    sub.on('event', (event: NDKEvent) => {
      if (seen.has(event.id)) return
      seen.add(event.id)
      if (!isReplyTo(event, eventId)) return
      setReplies((prev) => [...prev, event].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)))
    })

    return () => sub.stop()
  }, [eventId])

  return replies
}
