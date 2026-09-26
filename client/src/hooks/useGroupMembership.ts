import { useCallback, useEffect, useState } from 'react'
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet } from '../lib/ndk'
import { useRelayStatus } from './useRelayStatus'

export const GROUP_ADMIN_PUBLISH_TIMEOUT_MS = 8000

// NDK's NDKKind enum doesn't include NIP-29's delete-group (9008) — a
// real, ratified NIP-29 kind NDK just hasn't added a constant for.
const KIND_GROUP_DELETE_GROUP = 9008 as NDKKind

// See useNoteFeed.ts's comment — same missing-EOSE-fallback bug found
// across every long-lived subscription hook in this codebase.
const EOSE_FALLBACK_MS = 12000

// Exported so useGroupList.ts can reuse the exact same derivation to
// hide deleted groups from the discovery list — see its own comment for
// why this needs a real subscription across every group, not just the
// one this hook already scopes to via #h.
// The group's full current state, as every kind:9002/39000 pair must
// carry it — see publishGroupState below. Defined here (not in
// useGroupList.ts, whose Group type extends it) because useGroupList
// already imports from this file.
export type GroupState = {
  name: string
  about: string
  picture: string
  restricted: boolean
  priceSats: number
  payoutLud16: string
  // Community DAOs (2026-09-26): governance mode, enforced by
  // server/nip29.go (admin-only proposals, member-only votes).
  dao: boolean
}

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
//
// Role-aware since Paid Communities (2026-08-15), mirroring
// server/nip29.go's own applyPutUser exactly: a kind:9000 "p" tag with
// an explicit "member" role goes to the members set only (see
// deriveMembers below), not admins — this app's own promote() action
// has always sent an explicit "admin" role, and a bare tag with no role
// at all still degrades to admin (v1's original maximally-permissive
// reading, preserved for any other NIP-29 client's own promote action).
function deriveAdmins(history: HistoryEvent[]): Set<string> {
  const sorted = [...history].sort((a, b) => a.createdAt - b.createdAt)
  const admins = new Set<string>()
  for (const evt of sorted) {
    if (evt.kind === 9007) {
      admins.add(evt.pubkey)
    } else if (evt.kind === 9000) {
      for (const tag of evt.tags) {
        if (tag[0] === 'p' && tag[1] && tag[2] !== 'member') admins.add(tag[1])
      }
    } else if (evt.kind === 9001) {
      for (const tag of evt.tags) {
        if (tag[0] === 'p' && tag[1]) admins.delete(tag[1])
      }
    }
  }
  return admins
}

// The "member" tier, added by Paid Communities — a kind:9000 "p" tag
// with an explicit "member" role (what handleGroupJoinJob publishes once
// a paid join settles). A kind:9001 revokes both tiers at once, same as
// server/nip29.go's applyRemoveUser, since removing from a set that
// doesn't contain the key is a harmless no-op.
function deriveMembers(history: HistoryEvent[]): Set<string> {
  const sorted = [...history].sort((a, b) => a.createdAt - b.createdAt)
  const members = new Set<string>()
  for (const evt of sorted) {
    if (evt.kind === 9000) {
      for (const tag of evt.tags) {
        if (tag[0] === 'p' && tag[1] && tag[2] === 'member') members.add(tag[1])
      }
    } else if (evt.kind === 9001) {
      for (const tag of evt.tags) {
        if (tag[0] === 'p' && tag[1]) members.delete(tag[1])
      }
    }
  }
  return members
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

    const eoseFallback = setTimeout(() => setLoading(false), EOSE_FALLBACK_MS)

    return () => {
      clearTimeout(eoseFallback)
      sub.stop()
    }
  }, [groupId, generation])

  const admins = deriveAdmins(history)
  const members = deriveMembers(history)
  const isAdmin = useCallback((pubkey: string) => admins.has(pubkey), [admins])
  const isMember = useCallback((pubkey: string) => members.has(pubkey), [members])

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

  // Adds a plain voting member (kind:9000 with an explicit "member"
  // role), not an admin. Community DAOs (2026-09-26) need this: in a DAO
  // group that isn't paid, there was no other way to add someone who can
  // vote but not administer. Removal reuses demote() below — a kind:9001
  // revokes both tiers at once (see deriveMembers).
  const addMember = useCallback(
    async (pubkey: string) => {
      if (!groupId || busy || loading) return
      setBusy(pubkey)
      setError(null)
      try {
        const event = new NDKEvent(ndk, {
          kind: 9000,
          tags: [
            ['h', groupId],
            ['p', pubkey, 'member'],
          ],
        })
        await event.publish(localRelaySet, GROUP_ADMIN_PUBLISH_TIMEOUT_MS)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to add member')
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

  // Every kind:9002 this app publishes goes through here, always carrying
  // the group's FULL current state. server/nip29.go treats 9002 as a
  // full-state directive (per NIP-29, 9002 carries "all the fields of
  // group-metadata"): a flag missing from the newest 9002 means OFF. Real
  // bug found while building Community DAOs (2026-09-26), reproduced live
  // against a local relay: the old editMetadata published a 9002 with only
  // the h tag, so renaming a paid group silently un-restricted it (a
  // non-member could post straight afterwards), and its replacement 39000
  // also dropped price/payout. No production group was affected (checked:
  // no restricted group had ever been renamed). Also publishes the
  // matching kind:39000 display copy, which the client signs in this
  // design (server/nip29.go's create-group comment).
  const publishGroupState = useCallback(
    async (state: GroupState) => {
      if (!groupId) return
      const intentTags: string[][] = [['h', groupId]]
      if (state.restricted) intentTags.push(['restricted'])
      if (state.dao) intentTags.push(['dao'])
      const intent = new NDKEvent(ndk, { kind: 9002, tags: intentTags })
      await intent.publish(localRelaySet, GROUP_ADMIN_PUBLISH_TIMEOUT_MS)

      const tags: string[][] = [['d', groupId]]
      if (state.name.trim()) tags.push(['name', state.name.trim()])
      if (state.about.trim()) tags.push(['about', state.about.trim()])
      if (state.picture.trim()) tags.push(['picture', state.picture.trim()])
      if (state.restricted) {
        tags.push(['restricted'])
        tags.push(['price', String(Math.max(1, Math.round(state.priceSats)))])
        tags.push(['payout', state.payoutLud16.trim()])
      }
      if (state.dao) tags.push(['dao'])
      const meta = new NDKEvent(ndk, { kind: 39000, tags })
      await meta.publish(localRelaySet, GROUP_ADMIN_PUBLISH_TIMEOUT_MS)
    },
    [groupId],
  )

  const editMetadata = useCallback(
    async (current: GroupState, name: string, about: string, picture: string) => {
      if (!groupId || busy || loading) return
      setBusy('metadata')
      setError(null)
      try {
        await publishGroupState({ ...current, name, about, picture })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update metadata')
      } finally {
        setBusy(null)
      }
    },
    [groupId, busy, loading, publishGroupState],
  )

  // Enables or disables paid joining. Disabling (restricted=false) drops
  // restricted/price/payout entirely — the group is open again, same as
  // one that never had this set. Every other field (name/about/picture,
  // dao) is preserved from `current`.
  const setPaidJoining = useCallback(
    async (current: GroupState, restricted: boolean, priceSats: number, payoutLud16: string) => {
      if (!groupId || busy || loading) return
      setBusy('paid-joining')
      setError(null)
      try {
        await publishGroupState({ ...current, restricted, priceSats, payoutLud16 })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update paid joining')
      } finally {
        setBusy(null)
      }
    },
    [groupId, busy, loading, publishGroupState],
  )

  // Turns Community DAO mode on/off (server/nip29.go gates proposals to
  // admins and votes to members once on). Goes through publishGroupState
  // like every other 9002, so paid-joining settings are preserved.
  const setDaoMode = useCallback(
    async (current: GroupState, dao: boolean) => {
      if (!groupId || busy || loading) return
      setBusy('dao-mode')
      setError(null)
      try {
        await publishGroupState({ ...current, dao })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update DAO mode')
      } finally {
        setBusy(null)
      }
    },
    [groupId, busy, loading, publishGroupState],
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
    members: Array.from(members),
    isAdmin,
    isMember,
    isDeleted: deriveIsDeleted(history),
    promote,
    addMember,
    demote,
    editMetadata,
    setPaidJoining,
    setDaoMode,
    deleteGroup: deleteGroupAction,
    loading,
    busy,
    error,
  }
}
