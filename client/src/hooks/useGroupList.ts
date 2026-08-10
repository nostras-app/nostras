import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet } from '../lib/ndk'
import { useRelayStatus } from './useRelayStatus'

export type Group = {
  id: string
  name: string
  about: string
  picture: string
  createdAt: number
  hostPubkey: string
}

function parseGroupMetadata(evt: NDKEvent): Group | null {
  const id = evt.tags.find((t) => t[0] === 'd')?.[1]
  if (!id) return null
  return {
    id,
    name: evt.tags.find((t) => t[0] === 'name')?.[1] || id,
    about: evt.tags.find((t) => t[0] === 'about')?.[1] || '',
    picture: evt.tags.find((t) => t[0] === 'picture')?.[1] || '',
    createdAt: evt.created_at ?? 0,
    hostPubkey: evt.pubkey,
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
export function useGroupList() {
  const [groups, setGroups] = useState<Map<string, Group>>(new Map())
  const [loading, setLoading] = useState(true)
  const { generation } = useRelayStatus()

  useEffect(() => {
    setGroups(new Map())
    setLoading(true)

    const sub = ndk.subscribe({ kinds: [39000] }, { relaySet: localRelaySet })

    sub.on('event', (evt: NDKEvent) => {
      const group = parseGroupMetadata(evt)
      if (!group) return
      setGroups((prev) => {
        const existing = prev.get(group.id)
        if (existing && existing.createdAt >= group.createdAt) return prev
        const next = new Map(prev)
        next.set(group.id, group)
        return next
      })
    })

    sub.on('eose', () => setLoading(false))

    return () => sub.stop()
  }, [generation])

  return {
    groups: Array.from(groups.values()).sort((a, b) => b.createdAt - a.createdAt),
    loading,
  }
}
