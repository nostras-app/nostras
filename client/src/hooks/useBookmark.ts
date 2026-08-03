import { useCallback, useEffect, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'

// NIP-51 kind:10003 bookmark list — a single replaceable event per user
// listing 'e'-tagged bookmarked notes. Toggling fetches the current list
// (if any), adds/removes this note's e-tag, and republishes the whole
// list, same replaceable-event pattern as a mute list or relay list.
export function useBookmark(eventId: string) {
  const activeUser = useActiveUser()
  const [listEvent, setListEvent] = useState<NDKEvent | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeUser) {
      setListEvent(null)
      return
    }
    let cancelled = false
    ndk
      .fetchEvent({ kinds: [10003], authors: [activeUser.pubkey] })
      .then((event) => {
        if (!cancelled) setListEvent(event)
      })
    return () => {
      cancelled = true
    }
  }, [activeUser])

  const isBookmarked = listEvent?.tags.some(
    (t) => t[0] === 'e' && t[1] === eventId,
  ) ?? false

  const toggle = useCallback(async () => {
    if (!activeUser || busy) return
    setBusy(true)
    try {
      const existingTags = listEvent?.tags ?? []
      const nextTags = isBookmarked
        ? existingTags.filter((t) => !(t[0] === 'e' && t[1] === eventId))
        : [...existingTags, ['e', eventId]]

      const updated = new NDKEvent(ndk, {
        kind: 10003,
        tags: nextTags,
        content: listEvent?.content ?? '',
      })
      await updated.publish(devPublishRelaySet)
      setListEvent(updated)
    } finally {
      setBusy(false)
    }
  }, [activeUser, busy, eventId, isBookmarked, listEvent])

  return { isBookmarked, toggle, busy }
}
