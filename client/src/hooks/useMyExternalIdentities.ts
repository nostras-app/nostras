import { useEffect, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'
import {
  parseExternalIdentityTag,
  externalIdentityTagKey,
  type ExternalIdentity,
} from '../lib/externalIdentities'
import { KIND_EXTERNAL_IDENTITIES } from './useExternalIdentities'

// Matches useFollowing.ts/useBookmark.ts/useNip65RelayList.ts's own
// timeout convention.
const PUBLISH_TIMEOUT_MS = 8000

// NIP-39 external identities (kind:10011), edit side — the active
// user's own list only. Same fetch-then-republish safety shape this
// project settled on after fixing the identical class of bug three
// times (useFollowing/useBookmark/useNip65RelayList, see CLAUDE.md):
// a loading guard against mutating before the current list is known, an
// explicit publish timeout, and a real error surfaced on failure rather
// than a silent unhandled rejection. add/removeIdentity return a
// Promise<boolean> (not void) for the same reason useNip65RelayList's
// save() does — reading the hook's own error state immediately after
// await risks a stale closure; the caller needs a synchronous-with-await
// success signal instead. Deliberately not wrapped in useCallback — a
// small settings form, not a hot list depending on referential
// stability, so the extra memoization complexity isn't worth it.
export function useMyExternalIdentities() {
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
      .fetchEvent({ kinds: [KIND_EXTERNAL_IDENTITIES], authors: [activeUser.pubkey] })
      .then((event) => {
        if (cancelled) return
        setListEvent(event)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeUser])

  const identities: ExternalIdentity[] = (listEvent?.tags ?? [])
    .map(parseExternalIdentityTag)
    .filter((x): x is ExternalIdentity => x !== null)

  async function publish(nextTags: string[][]): Promise<boolean> {
    if (!activeUser || busy || loading) return false
    setBusy(true)
    setError(null)
    try {
      const updated = new NDKEvent(ndk, {
        kind: KIND_EXTERNAL_IDENTITIES,
        tags: nextTags,
        content: listEvent?.content ?? '',
      })
      await updated.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
      setListEvent(updated)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update linked accounts')
      return false
    } finally {
      setBusy(false)
    }
  }

  function addIdentity(platform: string, identity: string, proof: string) {
    const key = externalIdentityTagKey(platform, identity)
    const existingTags = (listEvent?.tags ?? []).filter((t) => !(t[0] === 'i' && t[1] === key))
    return publish([...existingTags, ['i', key, proof]])
  }

  function removeIdentity(platform: string, identity: string) {
    const key = externalIdentityTagKey(platform, identity)
    const nextTags = (listEvent?.tags ?? []).filter((t) => !(t[0] === 'i' && t[1] === key))
    return publish(nextTags)
  }

  return { identities, addIdentity, removeIdentity, busy, loading, error }
}
