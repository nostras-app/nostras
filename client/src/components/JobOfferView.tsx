import { useRef, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useActiveUser } from '../hooks/useActiveUser'
import { parseJobMeta, publishJobStatusUpdate, requestJobCompletionPayment } from '../lib/job'
import type { DvmJobUpdate } from '../lib/dvm'
import { formatRelativeTime } from '../lib/time'
import { setActiveView, viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { ArrowLeftIcon } from './icons'
import { NoteMenu } from './NoteMenu'
import { CommentSection } from './CommentSection'

type PayState = 'idle' | 'requesting' | 'payment-required' | 'done' | 'error'

// Pay this applicant — the DVM-mediated completion-payment flow. Mirrors
// ListingView.tsx's BuyNowPanel exactly (same processing/payment-
// required/done/error shape, same two-step-payment UI: the applicant's
// own reward, then NOSTRAS's flat fee). One real difference: on success
// this offers a one-click follow-up to also mark the job "paid" — the
// DVM can't do that itself (see server/cmd/dvm/main.go's
// handleJobCompletionPaymentJob), so the poster's own client has to.
function JobPaymentPanel({
  event,
  workerPubkey,
  onMarkedPaid,
}: {
  event: NDKEvent
  workerPubkey: string
  onMarkedPaid: () => void
}) {
  const [state, setState] = useState<PayState>('idle')
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState('')
  const [amountSats, setAmountSats] = useState(0)
  const [payee, setPayee] = useState<'worker' | 'nostras'>('worker')
  const [receiptId, setReceiptId] = useState('')
  const [paying, setPaying] = useState(false)
  const [marking, setMarking] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  function handlePay() {
    setState('requesting')
    setError('')
    cancelRef.current = requestJobCompletionPayment(event.id, workerPubkey, (update: DvmJobUpdate) => {
      if (update.status === 'processing') {
        setState('requesting')
      } else if (update.status === 'payment-required') {
        setInvoice(update.invoice)
        setAmountSats(Math.round(update.amountMsat / 1000))
        setPayee(update.payee === 'worker' ? 'worker' : 'nostras')
        setState('payment-required')
      } else if (update.status === 'done') {
        setReceiptId(update.result)
        setState('done')
      } else if (update.status === 'error') {
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

  async function handleMarkPaid() {
    setMarking(true)
    const result = await publishJobStatusUpdate(event, 'paid')
    setMarking(false)
    if (result.ok) onMarkedPaid()
    else setError(result.error)
  }

  function handleReset() {
    cancelRef.current?.()
    cancelRef.current = null
    setState('idle')
    setError('')
    setInvoice('')
  }

  return (
    <div className="stack" style={{ marginTop: '0.5rem' }}>
      {state === 'idle' && (
        <button type="button" className="btn btn-primary btn-sm" onClick={handlePay}>
          Pay this applicant
        </button>
      )}

      {state === 'requesting' && <p className="field-hint">Confirming…</p>}

      {state === 'payment-required' && (
        <div className="stack">
          <p className="field-hint">
            {payee === 'worker' ? 'Step 1 of 2 — pay the applicant' : "Step 2 of 2 — pay NOSTRAS's fee"}
            {' — you are paying '}
            <strong>{amountSats} sats</strong>.
          </p>
          <textarea className="textarea" readOnly value={invoice} rows={3} />
          <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigator.clipboard.writeText(invoice)}
            >
              Copy invoice
            </button>
            {getSavedNwcUri() && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handlePayWithWallet}
                disabled={paying}
              >
                {paying ? 'Paying…' : 'Pay with connected wallet'}
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleReset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state === 'done' && (
        <div className="stack">
          <p className="field-hint">
            Payment confirmed — a public receipt was published (
            <button
              type="button"
              className="feed-item-name-btn"
              onClick={() => navigator.clipboard.writeText(receiptId)}
              title="Copy receipt event id"
            >
              {receiptId.slice(0, 12)}…
            </button>
            ).
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleMarkPaid} disabled={marking}>
            {marking ? 'Saving…' : 'Mark this job as paid'}
          </button>
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

function OwnerControls({ event, status, onPaid }: { event: NDKEvent; status: 'open' | 'paid'; onPaid: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleMarkPaid() {
    setSaving(true)
    setError('')
    const result = await publishJobStatusUpdate(event, 'paid')
    if (result.ok) {
      onPaid()
    } else {
      setError(result.error)
    }
    setSaving(false)
  }

  if (status === 'paid') {
    return <p className="field-hint">Marked paid.</p>
  }

  return (
    <div className="stack">
      <button type="button" className="btn btn-secondary btn-sm" onClick={handleMarkPaid} disabled={saving}>
        {saving ? 'Saving…' : 'Mark as paid'}
      </button>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}

export function JobOfferView({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const activeUser = useActiveUser()
  const meta = parseJobMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const time = meta.publishedAt ?? event.created_at
  const isOwner = activeUser?.pubkey === event.pubkey
  // Same reasoning as ListingView's own soldOverride: meta is derived
  // from the `event` prop, which never changes after a status update
  // republishes a *new* event under the same address.
  const [paidOverride, setPaidOverride] = useState(false)
  const status = paidOverride ? 'paid' : meta.status
  const rewardLabel = meta.rewardAmount ? `${meta.rewardAmount} ${meta.rewardCurrency}` : null

  return (
    <div className="article-view">
      <button type="button" className="dm-back-btn" onClick={() => setActiveView('home')} title="Back">
        <ArrowLeftIcon />
      </button>

      <h1 className="article-view-title">{meta.title}</h1>

      <div className="listing-view-meta-row">
        {rewardLabel && <span className="listing-view-price">{rewardLabel}</span>}
        <span className={`listing-status-badge listing-status-${status === 'paid' ? 'sold' : 'active'}`}>
          {status}
        </span>
      </div>

      {meta.categories.length > 0 && (
        <div className="listing-view-categories">
          {meta.categories.map((c) => (
            <span key={c} className="relay-badge">
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="article-view-author-row">
        <button type="button" className="article-view-author" onClick={() => viewProfile(event.pubkey)}>
          {isSecureImageUrl(profile?.picture) ? (
            <img className="avatar" src={profile.picture} alt="" />
          ) : (
            <span className="avatar-fallback">{authorLabel.charAt(0)}</span>
          )}
          <span className="feed-item-name">{authorLabel}</span>
          {time && <span className="feed-item-time">{formatRelativeTime(time)}</span>}
        </button>
        <NoteMenu event={event} />
      </div>

      <div className="article-view-content">
        <p style={{ whiteSpace: 'pre-wrap' }}>{meta.description}</p>
      </div>

      {isOwner && <OwnerControls event={event} status={status} onPaid={() => setPaidOverride(true)} />}

      <CommentSection
        rootEvent={event}
        title="Applications"
        placeholder="Describe why you're a good fit for this job…"
        renderExtra={
          isOwner && status === 'open'
            ? (comment) =>
                comment.pubkey === activeUser?.pubkey ? null : (
                  <JobPaymentPanel event={event} workerPubkey={comment.pubkey} onMarkedPaid={() => setPaidOverride(true)} />
                )
            : undefined
        }
      />
    </div>
  )
}
