import { useCallback, useEffect, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'

// NDKEvent.publish() defaults to a 2.5s per-relay timeout — tight under
// real relay load. Matches the fix already applied to useFollowing.ts,
// Composer.tsx, and useNip65RelayList.ts for the identical bug class.
const PUBLISH_TIMEOUT_MS = 8000

// NIP-51 kind:10003 bookmark list — a single replaceable event per user
// listing 'e'-tagged bookmarked notes. Toggling fetches the current list
// (if any), adds/removes this note's e-tag, and republishes the whole
// list, same replaceable-event pattern as a mute list or relay list.
//
// Real bug fixed (2026-08-08), flagged earlier as the identical gap
// already found and fixed in useFollowing.ts: two issues, not one.
// (1) toggle() had no guard against running before the initial fetch of
// the CURRENT list resolved — `listEvent` starts null until that fetch
// completes, so `existingTags = listEvent?.tags ?? []` would be `[]`,
// and since kind:10003 is replaceable, toggling a bookmark before the
// fetch resolved would have silently overwritten the user's entire real
// bookmark list with just the one new entry. Real risk, not
// hypothetical — the bookmark button in EngagementBar.tsx was only ever
// disabled by `busy`, not by fetch-in-flight state. (2) No explicit
// publish timeout and no catch — a hung/rejected publish became a
// silent unhandled promise rejection: no error, no state update, button
// just appears to do nothing.
export function useBookmark(eventId: string) {
  const activeUser = useActiveUser()
  const [listEvent, setListEvent] = useState<NDKEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeUser) {
      setListEvent(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    ndk
      .fetchEvent({ kinds: [10003], authors: [activeUser.pubkey] })
      .then((event) => {
        if (cancelled) return
        setListEvent(event)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeUser])

  const isBookmarked = listEvent?.tags.some(
    (t) => t[0] === 'e' && t[1] === eventId,
  ) ?? false

  const toggle = useCallback(async () => {
    // Refuse to run before the initial fetch of the CURRENT list
    // resolves — see the fix note above for why this matters.
    if (!activeUser || busy || loading) return
    setBusy(true)
    setError(null)
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
      await updated.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
      setListEvent(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update bookmarks')
    } finally {
      setBusy(false)
    }
  }, [activeUser, busy, loading, eventId, isBookmarked, listEvent])

  return { isBookmarked, toggle, busy, loading, error }
}
