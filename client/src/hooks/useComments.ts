import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { KIND_COMMENT, isAddressableKind } from '../lib/comments'

// NIP-22 comments on a root item, oldest first — same subscribe/dedupe/
// sort shape as useReplies.ts (kind:1 note replies), just scoped to
// kind:1111 and the uppercase root tag instead of kind:1's "e" tag.
// Branches on whether the root is addressable (a NIP-23 article, "A")
// or a regular event (a NIP-7D forum thread, "E") — see comments.ts's
// own isAddressableKind comment for why the tag differs. Not left
// unscoped by accident: neither #A nor #E filters have an `authors`
// field, so this never routes through NDK's authors-filtered
// CONNECTED-only relay race documented elsewhere in this app (lib/ndk.ts's
// authorQueryRelaySet comment) — same reasoning already applied to
// useNotifications/useDirectMessages/useZapTotal, which stay unscoped too.
export function useComments(rootEvent: NDKEvent): NDKEvent[] {
  const [comments, setComments] = useState<NDKEvent[]>([])
  const addressable = isAddressableKind(rootEvent.kind)
  const rootTag = addressable ? 'A' : 'E'
  const rootValue = addressable ? rootEvent.tagAddress() : rootEvent.id

  useEffect(() => {
    setComments([])
    const seen = new Set<string>()
    // Two static filter literals rather than one with a computed `#${tag}`
    // key — TypeScript can't cleanly narrow a computed index-signature key
    // alongside the sibling `kinds` field in one object literal.
    const sub = addressable
      ? ndk.subscribe({ kinds: [KIND_COMMENT], '#A': [rootValue] })
      : ndk.subscribe({ kinds: [KIND_COMMENT], '#E': [rootValue] })

    sub.on('event', (event: NDKEvent) => {
      if (seen.has(event.id)) return
      seen.add(event.id)
      if (!event.tags.some((t) => t[0] === rootTag && t[1] === rootValue)) return
      setComments((prev) => [...prev, event].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)))
    })

    return () => sub.stop()
  }, [addressable, rootTag, rootValue])

  return comments
}
