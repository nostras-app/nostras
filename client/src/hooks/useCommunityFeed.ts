import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import {
  boardsRelaySet,
  KIND_COMMUNITY_POST,
  KIND_COMMUNITY_POST_APPROVAL,
  parseCommunityMeta,
} from '../lib/community'

const EOSE_FALLBACK_MS = 12000

// A board's live feed: every kind:1111 post scoped to it (via #a), plus
// every kind:4550 moderator approval scoped to it, cross-referenced to
// derive which posts are actually visible. Combined into one hook rather
// than two — approvals are meaningless without the posts they reference
// and vice versa, and this avoids the duplicate-subscription-per-row
// bug class already hit once in this codebase (DMs) from splitting a
// naturally-paired live subscription across components.
//
// Approval trust, per NIP-72's own real spec text ("anyone may issue an
// approval... clients should prioritize approvals from designated
// moderators"): only approvals authored by a pubkey the board's own
// definition lists as a moderator count here. Trusting any approval
// unconditionally would let a stranger "approve" their own spam into
// visibility — a real moderation bypass, not a hypothetical one.
export function useCommunityFeed(board: NDKEvent) {
  const [posts, setPosts] = useState<Map<string, NDKEvent>>(new Map())
  const [approvals, setApprovals] = useState<Map<string, NDKEvent>>(new Map())
  const [loading, setLoading] = useState(true)

  const address = board.tagAddress()
  const moderators = parseCommunityMeta(board.tags).moderators

  useEffect(() => {
    setPosts(new Map())
    setApprovals(new Map())
    setLoading(true)

    const sub = ndk.subscribe(
      [
        { kinds: [KIND_COMMUNITY_POST], '#a': [address] },
        { kinds: [KIND_COMMUNITY_POST_APPROVAL], '#a': [address] },
      ],
      { relaySet: boardsRelaySet },
    )

    sub.on('event', (evt: NDKEvent) => {
      if (evt.kind === KIND_COMMUNITY_POST) {
        setPosts((prev) => (prev.has(evt.id) ? prev : new Map(prev).set(evt.id, evt)))
      } else {
        setApprovals((prev) => (prev.has(evt.id) ? prev : new Map(prev).set(evt.id, evt)))
      }
    })

    sub.on('eose', () => setLoading(false))
    const eoseFallback = setTimeout(() => setLoading(false), EOSE_FALLBACK_MS)

    return () => {
      clearTimeout(eoseFallback)
      sub.stop()
    }
  }, [address])

  const approvedPostIds = new Set(
    Array.from(approvals.values())
      .filter((a) => moderators.includes(a.pubkey))
      .map((a) => a.tags.find((t) => t[0] === 'e')?.[1])
      .filter((id): id is string => !!id),
  )

  const allPosts = Array.from(posts.values()).sort(
    (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
  )

  return {
    approvedPosts: allPosts.filter((p) => approvedPostIds.has(p.id)),
    pendingPosts: allPosts.filter((p) => !approvedPostIds.has(p.id)),
    isModerator: (pubkey: string) => moderators.includes(pubkey),
    loading,
  }
}
