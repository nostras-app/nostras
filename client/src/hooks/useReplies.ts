import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

// A plain `#e` filter on kind:1 catches every note that references this
// id, not just direct replies (a quote or passing mention also tags the
// original via `e`) — NIP-10 marks the difference with a tag[3] marker
// ("reply"/"root"/"mention"). This app's own reply composer
// (EngagementBar.tsx) always tags `['e', id, '', 'reply']`; many other
// real clients still publish unmarked `e` tags for a reply, so both are
// accepted — only an explicit "mention" marker on this specific tag is
// excluded.
function isReplyTo(event: NDKEvent, eventId: string): boolean {
  return event.tags.some((t) => t[0] === 'e' && t[1] === eventId && t[3] !== 'mention')
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
