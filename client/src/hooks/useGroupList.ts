import { useEffect, useState } from 'react'
import { NDKKind, type NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet } from '../lib/ndk'
import { useRelayStatus } from './useRelayStatus'
import { deriveIsDeleted, type HistoryEvent } from './useGroupMembership'

// NDK's NDKKind enum doesn't include NIP-29's delete-group (9008) — a
// real, ratified NIP-29 kind NDK just hasn't added a constant for (same
// cast already needed in useGroupMembership.ts).
const KIND_GROUP_DELETE_GROUP = 9008 as NDKKind

// See useNoteFeed.ts's comment — same missing-EOSE-fallback bug found
// across every long-lived subscription hook in this codebase.
const EOSE_FALLBACK_MS = 12000

export type Group = {
  id: string
  name: string
  about: string
  picture: string
  createdAt: number
  hostPubkey: string
  // Paid Communities (2026-08-15) — parsed straight from this same
  // kind:39000 event's own ["restricted"]/["price"]/["payout"] tags,
  // the same fields server/cmd/dvm/main.go's handleGroupJoinJob reads
  // for pricing. Deliberately NOT the source of truth for whether
  // posting is actually gated — that's server/nip29.go's own kind:9002-
  // derived cache, reached via useGroupMembership's setPaidJoining,
  // which always publishes both events together so the two can't drift
  // apart in this app's own client (see nip29.go's own comment on why
  // kind:39000 alone isn't trusted for enforcement).
  restricted: boolean
  priceSats: number
  payoutLud16: string
}

function parseGroupMetadata(evt: NDKEvent): Group | null {
  const id = evt.tags.find((t) => t[0] === 'd')?.[1]
  if (!id) return null
  const restricted = evt.tags.some((t) => t[0] === 'restricted')
  return {
    id,
    name: evt.tags.find((t) => t[0] === 'name')?.[1] || id,
    about: evt.tags.find((t) => t[0] === 'about')?.[1] || '',
    picture: evt.tags.find((t) => t[0] === 'picture')?.[1] || '',
    createdAt: evt.created_at ?? 0,
    hostPubkey: evt.pubkey,
    restricted,
    priceSats: restricted ? Number(evt.tags.find((t) => t[0] === 'price')?.[1] ?? 0) : 0,
    payoutLud16: restricted ? evt.tags.find((t) => t[0] === 'payout')?.[1] || '' : '',
  }
}

// Live subscription to kind:39000 (group metadata) scoped to localRelaySet
// — communities are meant to live only on NOSTRAS's own self-hosted
// relay, same reasoning as NIP-50 search's local-only scope
// (server/search.go), not aggregated from public relays the way profile/
// contact data is (authorQueryRelaySet). Multiple different pubkeys can
// each publish a valid 39000 for the same group id — any current or
// former admin, each under their own address — since the relay itself
// deliberately doesn't try to pick one canonical author (see
// server/nip29.go's groupAddressableKinds comment); this dedupes by
// group id and keeps whichever copy has the newest created_at.
//
// Also subscribes to kind:9007/9008 (create/delete-group) — unscoped
// across every group, unlike useGroupMembership.ts's own #h-scoped
// subscription, precisely because this list needs to know deletion
// status for every group it might show, not just one. Real,
// user-reported gap: a group its own admin deleted (composer correctly
// disabled once opened) still showed up in this discovery list, since
// kind:39000 metadata staying in storage was never itself a deletion
// signal — see server/nip29.go's own comment on why 9008 doesn't (and
// structurally can't) remove the metadata event. Reuses
// useGroupMembership's deriveIsDeleted exactly, so a group deleted then
// legitimately re-created (the same edge case verified live for the
// per-group check) is correctly shown as active again here too, not
// permanently hidden.
export function useGroupList() {
  const [groups, setGroups] = useState<Map<string, Group>>(new Map())
  const [deletionHistory, setDeletionHistory] = useState<Map<string, HistoryEvent[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const { generation } = useRelayStatus()

  useEffect(() => {
    setGroups(new Map())
    setDeletionHistory(new Map())
    setLoading(true)

    const sub = ndk.subscribe(
      { kinds: [39000, 9007, KIND_GROUP_DELETE_GROUP] },
      { relaySet: localRelaySet },
    )

    sub.on('event', (evt: NDKEvent) => {
      if (evt.kind === 39000) {
        const group = parseGroupMetadata(evt)
        if (!group) return
        setGroups((prev) => {
          const existing = prev.get(group.id)
          if (existing && existing.createdAt >= group.createdAt) return prev
          const next = new Map(prev)
          next.set(group.id, group)
          return next
        })
        return
      }

      const id = evt.tags.find((t) => t[0] === 'h')?.[1]
      if (!id) return
      setDeletionHistory((prev) => {
        const next = new Map(prev)
        const list = next.get(id) ?? []
        next.set(id, [
          ...list,
          { kind: evt.kind, pubkey: evt.pubkey, createdAt: evt.created_at ?? 0, tags: evt.tags },
        ])
        return next
      })
    })

    sub.on('eose', () => setLoading(false))

    const eoseFallback = setTimeout(() => setLoading(false), EOSE_FALLBACK_MS)

    return () => {
      clearTimeout(eoseFallback)
      sub.stop()
    }
  }, [generation])

  // `groups` (deleted ones filtered out) is for the discovery list.
  // `findGroup` deliberately does NOT filter — CommunitiesView uses it
  // to resolve an explicit groupTarget (a "back" navigation into an
  // already-open deleted group, or a stale deep link), where "This
  // group has been deleted, existing messages remain visible below" is
  // the accurate thing to show, not a misleading "doesn't exist."
  return {
    groups: Array.from(groups.values())
      .filter((g) => !deriveIsDeleted(deletionHistory.get(g.id) ?? []))
      .sort((a, b) => b.createdAt - a.createdAt),
    findGroup: (id: string) => groups.get(id),
    loading,
  }
}
