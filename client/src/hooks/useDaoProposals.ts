import { useEffect, useMemo, useState } from 'react'
import type { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet } from '../lib/ndk'
import { KIND_POLL, KIND_POLL_RESPONSE, isPollEnded } from '../lib/poll'
import {
  DAO_LABEL_NAMESPACE,
  KIND_LABEL,
  labelTarget,
  labelValue,
  parseDaoProposal,
  parseTallyContent,
  type DaoProposal,
  type DaoTallyResult,
} from '../lib/dao'
import { useRelayStatus } from './useRelayStatus'

// See useNoteFeed.ts's comment — same missing-EOSE-fallback bug found
// across every long-lived subscription hook in this codebase.
const EOSE_FALLBACK_MS = 12000

export type ProposalStatus =
  | 'awaiting-registration' // published, fee not paid yet — not official
  | 'unregistered-expired' // voting ended without ever being registered
  | 'open'
  | 'counting' // registered, voting ended, DVM result not in yet
  | 'passed'
  | 'rejected'

export type DaoProposalView = {
  proposal: DaoProposal
  status: ProposalStatus
  tally: DaoTallyResult | null
  executed: { proof: string; byPubkey: string; at: number } | null
  // Live, unofficial counts: latest h-tagged vote per *current* member.
  // The official result is the DVM's tally label, which counts against
  // the membership snapshot at proposal creation instead.
  liveCounts: Record<string, number>
  liveVoted: number
  myVote: string | null
}

type Vote = { pubkey: string; createdAt: number; optionId: string }

// One subscription for the whole group (proposals, DAO labels, and votes
// together), not one per proposal card — this project has hit the
// "hook that opens a subscription called once per list row" bug twice
// already (DM conversation list, follow-list modal).
//
// Labels are only trusted from the right signer: open/passed/rejected
// from the DVM's community key (the one server/cmd/dvm/dao.go signs
// with), executed from a current group admin. Anyone can publish a
// kind:1985 with an h tag; the relay doesn't gate labels.
export function useDaoProposals(opts: {
  groupId: string
  communityKeyPubkey: string | null
  isAdmin: (pubkey: string) => boolean
  isEligible: (pubkey: string) => boolean
  myPubkey: string | null
}) {
  const { groupId, communityKeyPubkey, isAdmin, isEligible, myPubkey } = opts
  const [proposals, setProposals] = useState<Map<string, NDKEvent>>(new Map())
  const [labels, setLabels] = useState<Map<string, NDKEvent>>(new Map())
  const [votes, setVotes] = useState<Map<string, Map<string, Vote>>>(new Map())
  const [loading, setLoading] = useState(true)
  // Re-render periodically so "open" flips to "counting" at endsAt
  // without waiting for some unrelated event to arrive.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const { generation } = useRelayStatus()

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let stopped = false
    setProposals(new Map())
    setLabels(new Map())
    setVotes(new Map())
    setLoading(true)

    const sub = ndk.subscribe(
      [
        { kinds: [KIND_POLL as NDKKind], '#h': [groupId] },
        { kinds: [KIND_LABEL], '#L': [DAO_LABEL_NAMESPACE], '#h': [groupId] },
        { kinds: [KIND_POLL_RESPONSE as NDKKind], '#h': [groupId] },
      ],
      { relaySet: localRelaySet },
    )

    sub.on('event', (evt: NDKEvent) => {
      if (stopped) return
      if (evt.kind === KIND_POLL) {
        setProposals((prev) => (prev.has(evt.id) ? prev : new Map(prev).set(evt.id, evt)))
      } else if (evt.kind === KIND_LABEL) {
        setLabels((prev) => (prev.has(evt.id) ? prev : new Map(prev).set(evt.id, evt)))
      } else if (evt.kind === KIND_POLL_RESPONSE) {
        const target = evt.tags.find((t) => t[0] === 'e')?.[1]
        const optionId = evt.tags.find((t) => t[0] === 'response')?.[1]
        if (!target || !optionId) return
        setVotes((prev) => {
          const perProposal = prev.get(target) ?? new Map<string, Vote>()
          const existing = perProposal.get(evt.pubkey)
          if (existing && existing.createdAt >= (evt.created_at ?? 0)) return prev
          const nextPer = new Map(perProposal)
          nextPer.set(evt.pubkey, { pubkey: evt.pubkey, createdAt: evt.created_at ?? 0, optionId })
          return new Map(prev).set(target, nextPer)
        })
      }
    })
    sub.on('eose', () => {
      if (!stopped) setLoading(false)
    })
    const eoseFallback = setTimeout(() => {
      if (!stopped) setLoading(false)
    }, EOSE_FALLBACK_MS)

    return () => {
      stopped = true
      clearTimeout(eoseFallback)
      sub.stop()
    }
  }, [groupId, generation])

  const views = useMemo<DaoProposalView[]>(() => {
    const result: DaoProposalView[] = []
    for (const evt of proposals.values()) {
      const proposal = parseDaoProposal(evt)
      if (!proposal) continue

      let registered = false
      let tallyLabel: NDKEvent | null = null
      let executedLabel: NDKEvent | null = null
      for (const label of labels.values()) {
        if (labelTarget(label) !== evt.id) continue
        const value = labelValue(label)
        const fromCommunityKey = !!communityKeyPubkey && label.pubkey === communityKeyPubkey
        if (value === 'open' && fromCommunityKey) registered = true
        if ((value === 'passed' || value === 'rejected') && fromCommunityKey) tallyLabel = label
        if (value === 'executed' && isAdmin(label.pubkey)) {
          if (!executedLabel || (label.created_at ?? 0) > (executedLabel.created_at ?? 0)) executedLabel = label
        }
      }

      const ended = isPollEnded(proposal) || (proposal.endsAt !== null && proposal.endsAt <= now)
      let status: ProposalStatus
      if (tallyLabel) status = labelValue(tallyLabel) === 'passed' ? 'passed' : 'rejected'
      else if (registered) status = ended ? 'counting' : 'open'
      else status = ended ? 'unregistered-expired' : 'awaiting-registration'

      const liveCounts: Record<string, number> = {}
      let liveVoted = 0
      let myVote: string | null = null
      for (const vote of votes.get(evt.id)?.values() ?? []) {
        if (proposal.endsAt !== null && vote.createdAt > proposal.endsAt) continue
        if (vote.pubkey === myPubkey) myVote = vote.optionId
        if (!isEligible(vote.pubkey)) continue
        if (!proposal.options.some((o) => o.id === vote.optionId)) continue
        liveCounts[vote.optionId] = (liveCounts[vote.optionId] ?? 0) + 1
        liveVoted++
      }

      const proof = executedLabel?.tags.find((t) => t[0] === 'proof')?.[1] ?? ''
      result.push({
        proposal,
        status,
        tally: tallyLabel ? parseTallyContent(tallyLabel.content) : null,
        executed:
          executedLabel && status === 'passed'
            ? { proof, byPubkey: executedLabel.pubkey, at: executedLabel.created_at ?? 0 }
            : null,
        liveCounts,
        liveVoted,
        myVote,
      })
    }
    return result.sort((a, b) => (b.proposal.event.created_at ?? 0) - (a.proposal.event.created_at ?? 0))
  }, [proposals, labels, votes, communityKeyPubkey, isAdmin, isEligible, myPubkey, now])

  return { proposals: views, loading }
}
