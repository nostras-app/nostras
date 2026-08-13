import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { KIND_COMMENT } from '../lib/comments'

// NIP-22 comments on a root item, oldest first — same subscribe/dedupe/
// sort shape as useReplies.ts (kind:1 note replies), just scoped to
// kind:1111 and the uppercase "A" root-address tag instead of kind:1's
// "e" tag. Not left unscoped by accident: a #A tag filter has no
// `authors` field, so it never routes through NDK's authors-filtered
// CONNECTED-only relay race documented elsewhere in this app (lib/ndk.ts's
// authorQueryRelaySet comment) — same reasoning already applied to
// useNotifications/useDirectMessages/useZapTotal, which stay unscoped too.
export function useComments(rootEvent: NDKEvent): NDKEvent[] {
  const [comments, setComments] = useState<NDKEvent[]>([])
  const address = rootEvent.tagAddress()

  useEffect(() => {
    setComments([])
    const seen = new Set<string>()
    const sub = ndk.subscribe({ kinds: [KIND_COMMENT], '#A': [address] })

    sub.on('event', (event: NDKEvent) => {
      if (seen.has(event.id)) return
      seen.add(event.id)
      if (!event.tags.some((t) => t[0] === 'A' && t[1] === address)) return
      setComments((prev) => [...prev, event].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)))
    })

    return () => sub.stop()
  }, [address])

  return comments
}
