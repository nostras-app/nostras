import { useCallback, useEffect, useState } from 'react'
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet } from '../lib/ndk'
import { useRelayStatus } from './useRelayStatus'

export const GROUP_ADMIN_PUBLISH_TIMEOUT_MS = 8000

// NDK's NDKKind enum doesn't include NIP-29's delete-group (9008) — a
// real, ratified NIP-29 kind NDK just hasn't added a constant for.
const KIND_GROUP_DELETE_GROUP = 9008 as NDKKind

// Exported so useGroupList.ts can reuse the exact same derivation to
// hide deleted groups from the discovery list — see its own comment for
// why this needs a real subscription across every group, not just the
// one this hook already scopes to via #h.
export type HistoryEvent = { kind: number; pubkey: string; createdAt: number; tags: string[][] }

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

// Mirrors server/nip29.go's cache.createGroup/deleteGroup exactly: a
// 9008 removes the group id from the relay's own cache entirely (not
// just a flag), which means a *later* 9007 for the same id is genuinely
// accepted again (createGroup's own "already exists" guard only fires
// while the id is still in the map) — so "deleted" here has to be
// recomputed from the full chronological history, not just "does a 9008
// exist anywhere," or a group deleted and then legitimately re-created
// would incorrectly show as still deleted.
export function deriveIsDeleted(history: HistoryEvent[]): boolean {
  const sorted = [...history].sort((a, b) => a.createdAt - b.createdAt)
  let deleted = false
  for (const evt of sorted) {
    if (evt.kind === 9007) deleted = false
    else if (evt.kind === 9008) deleted = true
  }
  return deleted
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
      { kinds: [9007, 9000, 9001, KIND_GROUP_DELETE_GROUP], '#h': [groupId] },
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

  // Publishes kind:9008 (delete-group). Per server/nip29.go this stops
  // the group from accepting any *new* posts/moderation — it does not
  // and cannot bulk-remove already-stored kind:9 messages (badger has no
  // cheap "delete everything matching this h tag" operation), so
  // existing history stays fully visible. The UI surfacing this action
  // is responsible for saying that plainly, not implying a full erase.
  const deleteGroupAction = useCallback(async () => {
    if (!groupId || busy || loading) return
    setBusy('delete-group')
    setError(null)
    try {
      const event = new NDKEvent(ndk, { kind: 9008, tags: [['h', groupId]] })
      await event.publish(localRelaySet, GROUP_ADMIN_PUBLISH_TIMEOUT_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete group')
    } finally {
      setBusy(null)
    }
  }, [groupId, busy, loading])

  return {
    admins: Array.from(admins),
    isAdmin,
    isDeleted: deriveIsDeleted(history),
    promote,
    demote,
    editMetadata,
    deleteGroup: deleteGroupAction,
    loading,
    busy,
    error,
  }
}
