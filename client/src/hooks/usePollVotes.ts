import { useEffect, useState } from 'react'
import type { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { KIND_POLL_RESPONSE } from '../lib/poll'

type Vote = { pubkey: string; createdAt: number; optionIds: string[] }

// Per NIP-88: "only the most recent vote per public key counts" — so
// this dedupes by pubkey, keeping whichever response event has the
// latest created_at, rather than tallying every response event
// individually the way useZapList intentionally does for zap receipts
// (a repeat zap is a separate real contribution; a repeat vote is a
// correction, not an additional one).
export function usePollVotes(pollId: string, myPubkey?: string) {
  const [votesByPubkey, setVotesByPubkey] = useState<Map<string, Vote>>(new Map())

  useEffect(() => {
    setVotesByPubkey(new Map())
    const sub = ndk.subscribe({ kinds: [KIND_POLL_RESPONSE as NDKKind], '#e': [pollId] })

    sub.on('event', (event: NDKEvent) => {
      const optionIds = event.tags.filter((t) => t[0] === 'response').map((t) => t[1])
      if (optionIds.length === 0) return
      setVotesByPubkey((prev) => {
        const existing = prev.get(event.pubkey)
        if (existing && existing.createdAt >= (event.created_at ?? 0)) return prev
        const next = new Map(prev)
        next.set(event.pubkey, { pubkey: event.pubkey, createdAt: event.created_at ?? 0, optionIds })
        return next
      })
    })

    return () => sub.stop()
  }, [pollId])

  const votes = Array.from(votesByPubkey.values())
  const counts: Record<string, number> = {}
  for (const vote of votes) {
    for (const id of vote.optionIds) counts[id] = (counts[id] ?? 0) + 1
  }
  const totalVoters = votes.length
  const myVote = myPubkey ? votesByPubkey.get(myPubkey) : undefined

  return { counts, totalVoters, myVote }
}
