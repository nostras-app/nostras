import { NDKEvent, type NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet, localRelayUrl } from './ndk'
import { requestDvmJob, type DvmJobUpdate } from './dvm'
import { KIND_POLL, KIND_POLL_RESPONSE, parsePollMeta, type PollMeta } from './poll'

// Community DAOs, Piece 3 (2026-09-26) — the client half of the
// governance convention. Full design in nostr-client-node-strategy.md's
// "Community DAOs" section. The relay (server/nip29.go) gates who may
// publish a proposal/vote; the DVM (server/cmd/dvm/dao.go, job 5909)
// registers proposals for a flat fee and publishes the tally. Every read
// and write here is scoped to localRelaySet, never devPublishRelaySet —
// same standing rule as all other group data (see lib/communities.ts):
// group state lives only on NOSTRAS's own relay, and that's the only
// relay that enforces the DAO rules anyway.

export const KIND_LABEL = 1985 as NDKKind
export const DAO_LABEL_NAMESPACE = 'org.nostras.dao'
export const DAO_PROPOSAL_FEE_SATS = 21
const KIND_JOB_REQUEST_DAO_PROPOSAL = 5909
const KIND_JOB_RESULT_DAO_PROPOSAL = 6909
const PUBLISH_TIMEOUT_MS = 8000

// Proposals are always Yes/No with "yes" as the approving option. The
// convention itself allows any single-choice option set plus an
// ["approve", optionId] tag; fixing the ids here keeps the UI simple.
const OPTION_YES = 'yes'
const OPTION_NO = 'no'

export type DaoProposal = PollMeta & {
  event: NDKEvent
  groupId: string
  quorum: number
  threshold: number
  approve: string
  // Optional spending request — the owner still pays by hand from their
  // own wallet; these just record what the vote was about.
  amountSats: number | null
  payee: string | null
}

export function isDaoProposalEvent(event: NDKEvent): boolean {
  return event.kind === KIND_POLL && event.tags.some((t) => t[0] === 'h' && t[1])
}

export function parseDaoProposal(event: NDKEvent): DaoProposal | null {
  const groupId = event.tags.find((t) => t[0] === 'h')?.[1]
  const quorum = Number(event.tags.find((t) => t[0] === 'quorum')?.[1])
  const threshold = Number(event.tags.find((t) => t[0] === 'threshold')?.[1])
  const approve = event.tags.find((t) => t[0] === 'approve')?.[1]
  if (!groupId || !approve || !(quorum > 0 && quorum <= 1) || !(threshold > 0 && threshold <= 1)) return null
  const amount = Number(event.tags.find((t) => t[0] === 'amount')?.[1])
  return {
    ...parsePollMeta(event),
    event,
    groupId,
    quorum,
    threshold,
    approve,
    amountSats: amount > 0 ? amount : null,
    payee: event.tags.find((t) => t[0] === 'payee')?.[1] || null,
  }
}

export async function publishDaoProposal(opts: {
  groupId: string
  question: string
  endsInSeconds: number
  quorum: number
  threshold: number
  amountSats?: number
  payee?: string
}): Promise<NDKEvent> {
  const tags: string[][] = [
    ['h', opts.groupId],
    ['option', OPTION_YES, 'Yes'],
    ['option', OPTION_NO, 'No'],
    ['polltype', 'singlechoice'],
    ['approve', OPTION_YES],
    ['quorum', String(opts.quorum)],
    ['threshold', String(opts.threshold)],
    ['endsAt', String(Math.floor(Date.now() / 1000) + opts.endsInSeconds)],
    // NIP-88 requires at least one relay where responses should go —
    // for a DAO proposal that can only be our own relay.
    ['relay', localRelayUrl],
  ]
  if (opts.amountSats && opts.amountSats > 0) tags.push(['amount', String(Math.round(opts.amountSats))])
  if (opts.payee?.trim()) tags.push(['payee', opts.payee.trim()])

  const event = new NDKEvent(ndk, { kind: KIND_POLL, content: opts.question, tags })
  await event.publish(localRelaySet, PUBLISH_TIMEOUT_MS)
  return event
}

// A DAO vote must carry the group's h tag — that's what the relay gates to
// members, and it's the only kind of vote the DVM's tally counts. A plain
// NIP-88 vote (lib/poll.ts's publishVote) would be accepted by the relay
// but silently ignored by the tally.
export async function publishDaoVote(proposal: DaoProposal, optionId: string): Promise<void> {
  const event = new NDKEvent(ndk, {
    kind: KIND_POLL_RESPONSE,
    content: '',
    tags: [
      ['e', proposal.event.id],
      ['h', proposal.groupId],
      ['response', optionId],
    ],
  })
  await event.publish(localRelaySet, PUBLISH_TIMEOUT_MS)
}

export function requestProposalRegistration(
  proposalId: string,
  onUpdate: (update: DvmJobUpdate) => void,
): () => void {
  return requestDvmJob({
    requestKind: KIND_JOB_REQUEST_DAO_PROPOSAL,
    resultKind: KIND_JOB_RESULT_DAO_PROPOSAL,
    inputText: proposalId,
    onUpdate,
    relaySet: localRelaySet,
  })
}

// The owner/admin's own record that a passed spending proposal was
// actually paid out. Signed by the admin (not the DVM — NOSTRAS never
// touches treasury funds), with the payment proof they paste in (a
// Lightning preimage or a zap receipt id). The ledger only trusts
// "executed" labels from current admins.
export async function publishExecuted(proposal: DaoProposal, proof: string): Promise<void> {
  const tags: string[][] = [
    ['L', DAO_LABEL_NAMESPACE],
    ['l', 'executed', DAO_LABEL_NAMESPACE],
    ['e', proposal.event.id],
    ['h', proposal.groupId],
  ]
  if (proof.trim()) tags.push(['proof', proof.trim()])
  const event = new NDKEvent(ndk, {
    kind: KIND_LABEL,
    content: proof.trim() ? `Executed. Payment proof: ${proof.trim()}` : 'Executed.',
    tags,
  })
  await event.publish(localRelaySet, PUBLISH_TIMEOUT_MS)
}

export type DaoTallyResult = {
  eligible: number
  voted: number
  counts: Record<string, number>
  approve: string
  quorum: number
  threshold: number
  quorumMet: boolean
  approveShare: number
  passed: boolean
}

export function parseTallyContent(content: string): DaoTallyResult | null {
  try {
    const parsed = JSON.parse(content) as DaoTallyResult
    return typeof parsed.voted === 'number' && typeof parsed.eligible === 'number' ? parsed : null
  } catch {
    return null
  }
}

export function labelValue(event: NDKEvent): string | undefined {
  return event.tags.find((t) => t[0] === 'l' && t[2] === DAO_LABEL_NAMESPACE)?.[1]
}

export function labelTarget(event: NDKEvent): string | undefined {
  return event.tags.find((t) => t[0] === 'e')?.[1]
}
