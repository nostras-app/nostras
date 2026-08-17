import { useCallback, useEffect, useState } from 'react'
import { NDKEvent, normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, localRelayUrl, authorQueryRelaySet } from '../lib/ndk'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'
import { useActiveUser } from './useActiveUser'

const normalizedLocalRelayUrl = normalizeRelayUrl(localRelayUrl)

export interface Nip65Entry {
  url: string
  read: boolean
  write: boolean
}

function parseNip65Tags(tags: string[][]): Nip65Entry[] {
  return tags
    .filter((t) => t[0] === 'r' && !!t[1])
    .map((t) => {
      const marker = t[2]
      return { url: t[1], read: marker !== 'write', write: marker !== 'read' }
    })
}

function entriesToTags(entries: Nip65Entry[]): string[][] {
  return entries.map((e) => {
    if (e.read && e.write) return ['r', e.url]
    return ['r', e.url, e.read ? 'read' : 'write']
  })
}

// NIP-51/NIP-65 kind:10002 relay list — the same fetch-then-republish
// pattern as useBookmark (kind:10003) and the mute list (kind:10000).
// Feeds the server's outbox aggregation (server/outbox.go), which reads
// OTHER users' kind:10002 lists to fetch their notes — this hook manages
// publishing the active user's own, so other clients/relays can find them.
//
// Real bug hit (2026-08-08): save() had no explicit publish timeout and
// no catch — the exact same gap already fixed in useFollowing.ts and
// Composer.tsx. A publish that hung (rather than cleanly resolving or
// rejecting within NDK's default per-relay timeout) left `busy` stuck
// true forever with zero feedback: the "Save relay list" button just
// showed "Saving…" indefinitely, no error, nothing landed on any relay.
// Fixed with the same PUBLISH_TIMEOUT_MS + try/catch/error pattern.
const PUBLISH_TIMEOUT_MS = 8000

export function useNip65RelayList() {
  const activeUser = useActiveUser()
  const [entries, setEntries] = useState<Nip65Entry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeUser) {
      setEntries(null)
      return
    }
    let cancelled = false
    // fetchLatestReplaceableEvent, not plain ndk.fetchEvent() with no
    // relay set at all — exposed to both the unscoped-CONNECTED-only-
    // fallback race (2026-08-09) and closeOnEose's own convergence race
    // (2026-08-17, see CLAUDE.md's dated entry). A stale copy here would
    // seed the editor with an outdated relay list rather than the real
    // current one.
    fetchLatestReplaceableEvent({ kinds: [10002], authors: [activeUser.pubkey] }, authorQueryRelaySet)
      .then((event) => {
        if (cancelled) return
        if (event) {
          setEntries(parseNip65Tags(event.tags))
        } else {
          // Sensible starting point for a user with no list yet, rather
          // than an empty editor.
          setEntries([{ url: normalizedLocalRelayUrl, read: true, write: true }])
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeUser])

  // Returns whether the save actually succeeded — the caller (the
  // "Saved." confirmation in Nip65RelayListEditor.tsx) needs a
  // synchronous-with-await success signal, since reading `error` state
  // right after this resolves would risk a stale closure rather than
  // the value just set.
  const save = useCallback(
    async (next: Nip65Entry[]): Promise<boolean> => {
      if (!activeUser) return false
      setBusy(true)
      setError(null)
      try {
        const valid = next.filter((e) => e.read || e.write)
        const event = new NDKEvent(ndk, {
          kind: 10002,
          tags: entriesToTags(valid),
          content: '',
        })
        await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
        setEntries(valid)
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save relay list')
        return false
      } finally {
        setBusy(false)
      }
    },
    [activeUser],
  )

  return { entries, save, busy, error }
}
