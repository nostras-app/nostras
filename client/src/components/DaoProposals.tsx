import { useEffect, useRef, useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import { useDaoProposals, type DaoProposalView, type ProposalStatus } from '../hooks/useDaoProposals'
import { useProfile } from '../hooks/useProfile'
import {
  DAO_PROPOSAL_FEE_SATS,
  publishDaoProposal,
  publishDaoVote,
  parseDaoProposal,
  publishExecuted,
  requestProposalRegistration,
} from '../lib/dao'
import { formatEndsIn } from '../lib/poll'
import { formatRelativeTime } from '../lib/time'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { viewGroup } from '../lib/navigation'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

// Community DAOs, Piece 3 (2026-09-26). The ledger + proposal flow shown
// inside a DAO-mode group (GroupChatView's "Proposals" tab). See
// lib/dao.ts for the protocol side.

const DURATIONS: { label: string; seconds: number }[] = [
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '3 days', seconds: 3 * 86400 },
  { label: '7 days', seconds: 7 * 86400 },
]

const STATUS_LABELS: Record<ProposalStatus, string> = {
  'awaiting-registration': 'Awaiting registration',
  'unregistered-expired': 'Never registered',
  open: 'Open',
  counting: 'Counting',
  passed: 'Passed',
  rejected: 'Rejected',
}

function percent(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0
}

function ProposalComposer({ groupId }: { groupId: string }) {
  const [question, setQuestion] = useState('')
  const [duration, setDuration] = useState(DURATIONS[1].seconds)
  const [quorumPct, setQuorumPct] = useState('50')
  const [thresholdPct, setThresholdPct] = useState('50')
  const [amount, setAmount] = useState('')
  const [payee, setPayee] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [published, setPublished] = useState(false)

  const quorum = Number(quorumPct) / 100
  const threshold = Number(thresholdPct) / 100
  const valid =
    question.trim().length > 0 && quorum > 0 && quorum <= 1 && threshold > 0 && threshold <= 1 &&
    (amount.trim() === '' || Number(amount) > 0)

  async function handlePublish() {
    if (!valid || publishing) return
    setPublishing(true)
    setError('')
    try {
      await publishDaoProposal({
        groupId,
        question: question.trim(),
        endsInSeconds: duration,
        quorum,
        threshold,
        amountSats: amount.trim() ? Number(amount) : undefined,
        payee: payee.trim() || undefined,
      })
      setQuestion('')
      setAmount('')
      setPayee('')
      setPublished(true)
      setTimeout(() => setPublished(false), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish proposal')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="communities-create-form dao-composer">
      <textarea
        className="textarea"
        placeholder="What should the DAO decide? (members vote Yes or No)"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
      />
      <div className="dao-composer-row">
        <span className="field-hint">Voting lasts</span>
        {DURATIONS.map((d) => (
          <button
            key={d.seconds}
            type="button"
            className={`btn btn-sm ${duration === d.seconds ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setDuration(d.seconds)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="dao-composer-row">
        <label className="dao-composer-field">
          <span className="field-hint">Quorum %</span>
          <input className="input" inputMode="numeric" value={quorumPct} onChange={(e) => setQuorumPct(e.target.value)} />
        </label>
        <label className="dao-composer-field">
          <span className="field-hint">Yes must exceed %</span>
          <input className="input" inputMode="numeric" value={thresholdPct} onChange={(e) => setThresholdPct(e.target.value)} />
        </label>
      </div>
      <div className="dao-composer-row">
        <label className="dao-composer-field">
          <span className="field-hint">Spend (sats, optional)</span>
          <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="dao-composer-field dao-composer-field-wide">
          <span className="field-hint">Pay to (optional)</span>
          <input className="input" placeholder="name@domain" value={payee} onChange={(e) => setPayee(e.target.value)} />
        </label>
      </div>
      <p className="field-hint">
        After publishing, register the proposal ({DAO_PROPOSAL_FEE_SATS} sats to NOSTRAS) to make it
        official. Only registered proposals are counted.
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={handlePublish} disabled={!valid || publishing}>
          {publishing ? 'Publishing…' : published ? 'Published ✓' : 'Publish proposal'}
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}

type RegisterState = 'idle' | 'requesting' | 'payment-required' | 'done' | 'error'

// Same processing/payment-required/done/error shape as GroupChatView's
// JoinAndPayPanel, but a single payment (NOSTRAS's flat fee). In free mode
// the DVM skips straight to the result.
function RegisterPanel({ proposalId }: { proposalId: string }) {
  const [state, setState] = useState<RegisterState>('idle')
  const [invoice, setInvoice] = useState('')
  const [amountSats, setAmountSats] = useState(DAO_PROPOSAL_FEE_SATS)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cancelRef.current?.(), [])

  function handleRegister() {
    setState('requesting')
    setError('')
    cancelRef.current = requestProposalRegistration(proposalId, (update) => {
      if (update.status === 'processing') setState('requesting')
      else if (update.status === 'payment-required') {
        setInvoice(update.invoice)
        setAmountSats(Math.round(update.amountMsat / 1000))
        setState('payment-required')
      } else if (update.status === 'done') setState('done')
      else if (update.status === 'error') {
        setError(update.message)
        setState('error')
      }
    })
  }

  async function handlePayWithWallet() {
    const nwcUri = getSavedNwcUri()
    if (!nwcUri) return
    setPaying(true)
    try {
      await payInvoiceWithNwc(nwcUri, invoice)
      setState('requesting')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
      setState('error')
    } finally {
      setPaying(false)
    }
  }

  function handleReset() {
    cancelRef.current?.()
    cancelRef.current = null
    setState('idle')
    setError('')
    setInvoice('')
  }

  if (state === 'done') return <p className="field-hint">Registered — voting is open.</p>

  return (
    <div className="stack">
      {state === 'idle' && (
        <button type="button" className="btn btn-primary btn-sm" onClick={handleRegister}>
          Register ({DAO_PROPOSAL_FEE_SATS} sats)
        </button>
      )}
      {state === 'requesting' && <p className="field-hint">Registering…</p>}
      {state === 'payment-required' && (
        <div className="stack">
          <p className="field-hint">
            NOSTRAS's registration fee — you are paying <strong>{amountSats} sats</strong>.
          </p>
          <textarea className="textarea" readOnly value={invoice} rows={3} />
          <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(invoice)}>
              Copy invoice
            </button>
            {getSavedNwcUri() && (
              <button type="button" className="btn btn-primary btn-sm" onClick={handlePayWithWallet} disabled={paying}>
                {paying ? 'Paying…' : 'Pay with connected wallet'}
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleReset}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {state === 'error' && (
        <div className="stack">
          <p className="alert-error">{error}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleReset}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

function ExecutePanel({ view }: { view: DaoProposalView }) {
  const [open, setOpen] = useState(false)
  const [proof, setProof] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setBusy(true)
    setError('')
    try {
      await publishExecuted(view.proposal, proof)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as executed')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        Mark executed
      </button>
    )
  }
  return (
    <div className="stack">
      <p className="field-hint">
        Pay this from your own wallet first, then paste the payment proof (Lightning preimage or zap
        receipt id) so members can check it.
      </p>
      <input className="input" placeholder="Payment proof" value={proof} onChange={(e) => setProof(e.target.value)} />
      <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}

function ProposalCard({
  view,
  viewerIsAdmin,
  viewerCanVote,
}: {
  view: DaoProposalView
  viewerIsAdmin: boolean
  viewerCanVote: boolean
}) {
  const { proposal, status, tally, executed, liveCounts, liveVoted, myVote } = view
  const author = useProfile(proposal.event.pubkey)
  const authorLabel = author?.name || author?.displayName || `${nip19.npubEncode(proposal.event.pubkey).slice(0, 12)}…`
  const [voting, setVoting] = useState<string | null>(null)
  const [error, setError] = useState('')

  const counts = tally?.counts ?? liveCounts
  const voted = tally?.voted ?? liveVoted

  async function handleVote(optionId: string) {
    setVoting(optionId)
    setError('')
    try {
      await publishDaoVote(proposal, optionId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to vote')
    } finally {
      setVoting(null)
    }
  }

  const statusClass = executed ? 'dao-status-executed' : `dao-status-${status}`

  return (
    <li className="feed-item poll-card dao-proposal-card">
      <div className="feed-item-meta">
        <span className="feed-item-name">{authorLabel}</span>
        {proposal.event.created_at && (
          <span className="feed-item-time">{formatRelativeTime(proposal.event.created_at)}</span>
        )}
        <span className={`relay-badge dao-status ${statusClass}`}>{executed ? 'Executed' : STATUS_LABELS[status]}</span>
      </div>

      <p className="poll-question">{proposal.question}</p>
      {proposal.amountSats !== null && (
        <p className="field-hint">
          Spend <strong>{proposal.amountSats.toLocaleString()} sats</strong>
          {proposal.payee ? <> to <code>{proposal.payee}</code></> : null}, paid by the owner from their own wallet if it passes.
        </p>
      )}

      <div className="poll-options">
        {proposal.options.map((opt) => {
          const count = counts[opt.id] ?? 0
          const pct = percent(count, voted)
          const mine = myVote === opt.id
          return (
            <div key={opt.id} className={`poll-option-result${mine ? ' poll-option-mine' : ''}`}>
              <div className="poll-option-result-row">
                <span>
                  {opt.label}
                  {mine ? ' ✓' : ''}
                </span>
                <span>
                  {count} · {pct}%
                </span>
              </div>
              <div className="poll-option-bar-track">
                <div className="poll-option-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      <p className="poll-meta-line">
        {tally ? (
          <>
            Official result: {tally.voted} of {tally.eligible} members voted
            {tally.quorumMet ? '' : ' (quorum not met)'} · Yes {percent(tally.counts[tally.approve] ?? 0, tally.voted)}%
          </>
        ) : (
          <>
            {voted} {voted === 1 ? 'vote' : 'votes'} so far (live, unofficial)
            {status === 'open' && proposal.endsAt ? ` · Ends in ${formatEndsIn(proposal.endsAt)}` : ''}
            {status === 'counting' ? ' · Voting closed, counting…' : ''}
          </>
        )}
        {' · '}Quorum {Math.round(proposal.quorum * 100)}%, Yes must exceed {Math.round(proposal.threshold * 100)}%
      </p>

      {status === 'open' && viewerCanVote && (
        <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
          {proposal.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`btn btn-sm ${myVote === opt.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleVote(opt.id)}
              disabled={voting !== null}
            >
              {voting === opt.id ? 'Voting…' : myVote ? `Change to ${opt.label}` : `Vote ${opt.label}`}
            </button>
          ))}
        </div>
      )}
      {status === 'open' && !viewerCanVote && <p className="field-hint">Only members of this group can vote.</p>}
      {status === 'awaiting-registration' && viewerIsAdmin && <RegisterPanel proposalId={proposal.event.id} />}
      {status === 'awaiting-registration' && !viewerIsAdmin && (
        <p className="field-hint">Not official yet — waiting for an admin to register it.</p>
      )}
      {status === 'passed' && !executed && proposal.amountSats !== null && viewerIsAdmin && <ExecutePanel view={view} />}
      {executed && (
        <p className="field-hint">
          Marked executed {formatRelativeTime(executed.at)}
          {executed.proof ? <> — proof: <code className="dao-proof">{executed.proof}</code></> : ' (no proof given)'}
        </p>
      )}
      {error && <p className="alert-error">{error}</p>}
    </li>
  )
}

export function DaoProposalsView({
  groupId,
  communityKeyPubkey,
  viewerIsAdmin,
  viewerCanVote,
  isAdmin,
  isEligible,
  myPubkey,
}: {
  groupId: string
  communityKeyPubkey: string | null
  viewerIsAdmin: boolean
  viewerCanVote: boolean
  isAdmin: (pubkey: string) => boolean
  isEligible: (pubkey: string) => boolean
  myPubkey: string | null
}) {
  const { proposals, loading } = useDaoProposals({ groupId, communityKeyPubkey, isAdmin, isEligible, myPubkey })

  return (
    <div className="dao-proposals">
      <p className="field-hint">
        Members vote on proposals; each result is counted and published by NOSTRAS's DVM so anyone can
        check it. The treasury is the group owner's own wallet: votes about money are a mandate the owner
        is trusted to carry out, and "Mark executed" records whether they did.
      </p>
      {!communityKeyPubkey && (
        <p className="alert-error">
          Can't reach NOSTRAS's DVM right now, so proposal status can't be verified.
        </p>
      )}
      {viewerIsAdmin && <ProposalComposer groupId={groupId} />}
      {loading && proposals.length === 0 && <p className="dm-thread-empty-hint">Loading proposals…</p>}
      {!loading && proposals.length === 0 && <p className="dm-thread-empty-hint">No proposals yet.</p>}
      <ul className="feed dao-proposal-list">
        {proposals.map((view) => (
          <ProposalCard
            key={view.proposal.event.id}
            view={view}
            viewerIsAdmin={viewerIsAdmin}
            viewerCanVote={viewerCanVote}
          />
        ))}
      </ul>
    </div>
  )
}

// How a DAO proposal looks when it turns up in an ordinary feed (the home
// feed subscribes to kind:1068 on our relay, so group proposals arrive
// there too). Deliberately not votable here: a vote from a generic
// PollCard would be a plain NIP-88 response without the group's h tag,
// which the relay can't gate and the tally ignores. Voting happens in the
// group's Proposals tab, where membership and status are known.
export function DaoProposalFeedCard({ event }: { event: NDKEvent }) {
  const proposal = parseDaoProposal(event)
  const author = useProfile(event.pubkey)
  const authorLabel = author?.name || author?.displayName || `${nip19.npubEncode(event.pubkey).slice(0, 12)}…`
  if (!proposal) return null
  return (
    <li className="feed-item poll-card dao-proposal-card">
      <div className="feed-item-meta">
        <span className="feed-item-name">{authorLabel}</span>
        {event.created_at && <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>}
        <span className="relay-badge dao-status">Community proposal</span>
      </div>
      <p className="poll-question">{proposal.question}</p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => viewGroup(proposal.groupId)}>
        Open in its community
      </button>
    </li>
  )
}
