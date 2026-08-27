import { useCallback, useEffect, useState } from 'react'
import { NDKEvent, normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, localRelayUrl, authorQueryRelaySet } from '../lib/ndk'
import { DM_RELAY_LIST_KIND, parseDmRelayTags } from '../lib/dm'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'
import { useActiveUser } from './useActiveUser'

const normalizedLocalRelayUrl = normalizeRelayUrl(localRelayUrl)

// NIP-17 kind:10050 "DM relay list" — the active user's own copy, published
// so other NIP-17-aware clients know where to deliver gift-wrapped DMs to
// this identity, instead of silently falling back to general NIP-65 write
// relays (which lib/dm.ts's discoverRecipientDmRelays already does for
// OTHER users' lists — this hook is the missing publish side for our own).
// Same fetch-then-republish safety shape already settled on for
// useFollowing/useBookmark/useNip65RelayList after real bugs were found and
// fixed in each: fetchLatestReplaceableEvent + authorQueryRelaySet (not a
// plain unscoped fetchEvent(), which races both an unscoped-CONNECTED-only
// relay fallback and closeOnEose's own stale-copy convergence), an explicit
// publish timeout, and save() returning a boolean rather than void so the
// caller can react synchronously instead of risking a stale-closure error
// read.
const PUBLISH_TIMEOUT_MS = 8000

export function useDmRelayList() {
  const activeUser = useActiveUser()
  const [entries, setEntries] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeUser) {
      setEntries(null)
      return
    }
    let cancelled = false
    fetchLatestReplaceableEvent(
      { kinds: [DM_RELAY_LIST_KIND], authors: [activeUser.pubkey] },
      authorQueryRelaySet,
    ).then((event) => {
      if (cancelled) return
      if (event) {
        setEntries(parseDmRelayTags(event.tags))
      } else {
        // Sensible starting point for a user with no list yet — mirrors
        // the NIP-65 editor's own precedent of seeding the local relay
        // rather than an empty editor.
        setEntries([normalizedLocalRelayUrl])
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeUser])

  const save = useCallback(
    async (next: string[]): Promise<boolean> => {
      if (!activeUser) return false
      setBusy(true)
      setError(null)
      try {
        const event = new NDKEvent(ndk, {
          kind: DM_RELAY_LIST_KIND,
          // NIP-17's own spec text: kind:10050 uses "relay" tags, not
          // "r" — see parseDmRelayTags's comment in lib/dm.ts for the
          // real production bug this fixed.
          tags: next.map((url) => ['relay', url]),
          content: '',
        })
        await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
        setEntries(next)
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save DM relay list')
        return false
      } finally {
        setBusy(false)
      }
    },
    [activeUser],
  )

  return { entries, save, busy, error }
}
