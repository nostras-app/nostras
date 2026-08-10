import { useCallback, useEffect, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet } from '../lib/ndk'
import { useRelayStatus } from './useRelayStatus'

export const GROUP_ADMIN_PUBLISH_TIMEOUT_MS = 8000

type HistoryEvent = { kind: number; pubkey: string; createdAt: number; tags: string[][] }

// Deliberately mirrors server/nip29.go's applyNip29CacheEvent exactly —
// kind:9007 (create) seeds the creator as admin, 9000 (put-user) adds,
// 9001 (remove-user) removes, replayed in chronological order. NOT
// derived from kind:39001 (admins list) — that was tried first and found
// to be wrong during Piece 1's own server-side verification: a
// self-published 39001 from when a user WAS admin stays in storage
// untouched after a later demotion (different admins publish under
// different addresses, so nothing supersedes it), so trusting it here
// would show a demoted user their own admin panel even though every
// actual action they took would be rejected by the relay. Replaying the
// same 9007/9000/9001 history the relay itself trusts keeps the client
// and server never disagreeing about who's actually an admin.
function deriveAdmins(history: HistoryEvent[]): Set<string> {
  const sorted = [...history].sort((a, b) => a.createdAt - b.createdAt)
  const admins = new Set<string>()
  for (const evt of sorted) {
    if (evt.kind === 9007) {
      admins.add(evt.pubkey)
    } else if (evt.kind === 9000) {
      for (const tag of evt.tags) {
        if (tag[0] === 'p' && tag[1]) admins.add(tag[1])
      }
    } else if (evt.kind === 9001) {
      for (const tag of evt.tags) {
        if (tag[0] === 'p' && tag[1]) admins.delete(tag[1])
      }
    }
  }
  return admins
}

export function useGroupMembership(groupId: string | null) {
  const [history, setHistory] = useState<HistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { generation } = useRelayStatus()

  useEffect(() => {
    if (!groupId) {
      setHistory([])
      setLoading(false)
      return
    }

    setHistory([])
    setLoading(true)
    const seenIds = new Set<string>()

    const sub = ndk.subscribe(
      { kinds: [9007, 9000, 9001], '#h': [groupId] },
      { relaySet: localRelaySet },
    )

    sub.on('event', (evt: NDKEvent) => {
      if (seenIds.has(evt.id)) return
      seenIds.add(evt.id)
      setHistory((prev) => [
        ...prev,
        { kind: evt.kind, pubkey: evt.pubkey, createdAt: evt.created_at ?? 0, tags: evt.tags },
      ])
    })

    sub.on('eose', () => setLoading(false))

    return () => sub.stop()
  }, [groupId, generation])

  const admins = deriveAdmins(history)
  const isAdmin = useCallback((pubkey: string) => admins.has(pubkey), [admins])

  const promote = useCallback(
    async (pubkey: string) => {
      if (!groupId || busy || loading) return
      setBusy(pubkey)
      setError(null)
      try {
        const event = new NDKEvent(ndk, {
          kind: 9000,
          tags: [
            ['h', groupId],
            ['p', pubkey, 'admin'],
          ],
        })
        await event.publish(localRelaySet, GROUP_ADMIN_PUBLISH_TIMEOUT_MS)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to promote')
      } finally {
        setBusy(null)
      }
    },
    [groupId, busy, loading],
  )

  const demote = useCallback(
    async (pubkey: string) => {
      if (!groupId || busy || loading) return
      setBusy(pubkey)
      setError(null)
      try {
        const event = new NDKEvent(ndk, {
          kind: 9001,
          tags: [
            ['h', groupId],
            ['p', pubkey],
          ],
        })
        await event.publish(localRelaySet, GROUP_ADMIN_PUBLISH_TIMEOUT_MS)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to demote')
      } finally {
        setBusy(null)
      }
    },
    [groupId, busy, loading],
  )

  // Publishes both the 9002 moderation-intent event and the actual
  // replacement 39000 metadata — the client is the one that signs group
  // metadata in this design (server/nip29.go's create-group comment), so
  // 9002 alone wouldn't change anything a reader could see without this.
  const editMetadata = useCallback(
    async (name: string, about: string, picture: string) => {
      if (!groupId || busy || loading) return
      setBusy('metadata')
      setError(null)
      try {
        const intent = new NDKEvent(ndk, { kind: 9002, tags: [['h', groupId]] })
        await intent.publish(localRelaySet, GROUP_ADMIN_PUBLISH_TIMEOUT_MS)

        const tags: string[][] = [['d', groupId]]
        if (name.trim()) tags.push(['name', name.trim()])
        if (about.trim()) tags.push(['about', about.trim()])
        if (picture.trim()) tags.push(['picture', picture.trim()])
        const meta = new NDKEvent(ndk, { kind: 39000, tags })
        await meta.publish(localRelaySet, GROUP_ADMIN_PUBLISH_TIMEOUT_MS)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update metadata')
      } finally {
        setBusy(null)
      }
    },
    [groupId, busy, loading],
  )

  return {
    admins: Array.from(admins),
    isAdmin,
    promote,
    demote,
    editMetadata,
    loading,
    busy,
    error,
  }
}
