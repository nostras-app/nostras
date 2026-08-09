import { useCallback, useEffect, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, localRelaySet } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'

// kind:3 contact list — same fetch-then-republish pattern as useBookmark
// (kind:10003) and the mute list. `p` tags are the followed pubkeys;
// toggle() only ever adds/removes the one `p` tag it's touching and
// preserves everything else about the list (other tags, content) as-is,
// since some clients still put legacy relay-list JSON in kind:3's content.
//
// Real bug found and fixed (2026-08-07), reported as "Follow works
// inconsistently": two real gaps, not one. (1) toggle() had no guard
// against running before the initial fetch of the CURRENT list
// completed — if a user clicked Follow before that fetch resolved,
// `tags` was still `[]`, and since kind:3 is a *replaceable* event, the
// publish would have overwritten their entire real contact list with
// just the one new follow. Real risk, not hypothetical, especially for
// a large list (slower to fetch) or a relay under load (more likely to
// still be loading when a quick click happens). (2) NDKEvent.publish()
// defaults to a 2.5s per-relay timeout, and the click handler
// (ProfileView.tsx) had no .catch() at all — a publish that took even
// slightly longer than 2.5s (demonstrated as a real possibility under
// load; see the outbox-aggregation incident in CLAUDE.md) became a
// silent unhandled promise rejection: no error shown, no state update,
// button just appears to do nothing. Fixed by (a) refusing to toggle
// while the initial fetch is still in flight, (b) passing an explicit,
// more realistic 8s timeout matching this project's other load-related
// fixes, and (c) catching publish failures into a real `error` state
// the UI can show instead of swallowing them.
const PUBLISH_TIMEOUT_MS = 8000

export function useFollowing() {
  const activeUser = useActiveUser()
  const [pubkeys, setPubkeys] = useState<string[]>([])
  const [tags, setTags] = useState<string[][]>([])
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeUser) {
      setPubkeys([])
      setTags([])
      setContent('')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    // Scoped to localRelaySet, not left to NDK's own client-side outbox
    // resolution — an unscoped authors-filtered fetchEvent races against
    // real-time relay connection state (calculateRelaySetsFromFilter falls
    // back to pool.permanentAndConnectedRelays(), which only counts relays
    // already CONNECTED at call time) and can resolve on a stale/partial
    // relay subset before a newer copy elsewhere finishes connecting. Real
    // bug, not hypothetical (2026-08-09): a second identity's real follow
    // of another user lived only on relay.damus.io, a day newer than the
    // stale copy already on our own relay — this fetchEvent silently
    // returned the stale one, showing "Follow" instead of "Unfollow".
    // Same fix already proven for the NIP-23 deeplink bug: our own relay's
    // server-side outbox aggregation (server/outbox.go) already fans out
    // to the author's real write relays for any authors-filtered query it
    // receives, so cross-relay discovery still happens — just through a
    // single, already-connected, bounded-timeout server path instead of a
    // multi-relay client-side race.
    ndk.fetchEvent({ kinds: [3], authors: [activeUser.pubkey] }, undefined, localRelaySet).then((event) => {
      if (cancelled) return
      const nextTags = event?.tags ?? []
      setTags(nextTags)
      setContent(event?.content ?? '')
      setPubkeys(nextTags.filter((t) => t[0] === 'p' && !!t[1]).map((t) => t[1]))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [activeUser])

  const isFollowing = useCallback((pubkey: string) => pubkeys.includes(pubkey), [pubkeys])

  const toggle = useCallback(
    async (pubkey: string) => {
      // Refuse to run before the initial fetch of the CURRENT list
      // resolves — `tags` would still be `[]`, and since kind:3 is
      // replaceable, publishing now would overwrite the user's entire
      // real contact list with just this one follow.
      if (!activeUser || busy || loading) return
      setBusy(pubkey)
      setError(null)
      try {
        const currentlyFollowing = pubkeys.includes(pubkey)
        const nextTags = currentlyFollowing
          ? tags.filter((t) => !(t[0] === 'p' && t[1] === pubkey))
          : [...tags, ['p', pubkey]]
        const event = new NDKEvent(ndk, { kind: 3, tags: nextTags, content })
        await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
        setTags(nextTags)
        setPubkeys(nextTags.filter((t) => t[0] === 'p' && !!t[1]).map((t) => t[1]))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update follow list')
      } finally {
        setBusy(null)
      }
    },
    [activeUser, pubkeys, tags, content, busy, loading],
  )

  return { pubkeys, isFollowing, toggle, loading, busy, error }
}
