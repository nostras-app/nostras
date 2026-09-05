import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { boardsRelaySet, KIND_COMMUNITY_DEFINITION, parseCommunityMeta } from '../lib/community'

// Same missing-EOSE-fallback bug already found across every long-lived
// subscription hook in this codebase (useNoteFeed.ts, useGroupList.ts,
// etc.) — a fresh precaution here, not a rediscovery.
const EOSE_FALLBACK_MS = 12000

// Discovery list of kind:34550 board (NIP-72 community) definitions.
// Dedupes by (pubkey, d-tag) address, keeping whichever copy has the
// newest created_at — the same replaceable-event handling
// useGroupList.ts already established for NIP-29 groups, since a board
// owner can republish their own definition (rename, change image, add a
// moderator) under the same address.
export function useCommunityList() {
  const [boards, setBoards] = useState<Map<string, NDKEvent>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setBoards(new Map())
    setLoading(true)

    const sub = ndk.subscribe({ kinds: [KIND_COMMUNITY_DEFINITION] }, { relaySet: boardsRelaySet })

    sub.on('event', (evt: NDKEvent) => {
      const address = evt.tagAddress()
      setBoards((prev) => {
        const existing = prev.get(address)
        if (existing && (existing.created_at ?? 0) >= (evt.created_at ?? 0)) return prev
        const next = new Map(prev)
        next.set(address, evt)
        return next
      })
    })

    sub.on('eose', () => setLoading(false))
    const eoseFallback = setTimeout(() => setLoading(false), EOSE_FALLBACK_MS)

    return () => {
      clearTimeout(eoseFallback)
      sub.stop()
    }
  }, [])

  const list = Array.from(boards.values()).sort(
    (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
  )

  return {
    boards: list.map((evt) => ({ event: evt, meta: parseCommunityMeta(evt.tags) })),
    findBoard: (address: string) => boards.get(address),
    loading,
  }
}
