import { useEffect, useRef, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useActiveUser } from '../hooks/useActiveUser'
import { parseListingMeta, publishListingStatusUpdate, requestListingPurchase } from '../lib/listing'
import type { DvmJobUpdate } from '../lib/dvm'
import { formatRelativeTime } from '../lib/time'
import { setActiveView, viewProfile, startDmWith } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { ArrowLeftIcon } from './icons'
import { NoteMenu } from './NoteMenu'
import { ZapButton } from './ZapButton'

type BuyState = 'idle' | 'requesting' | 'payment-required' | 'done' | 'error'

// Buy Now — the DVM-mediated purchase-confirmation flow. Mirrors
// ArticleView.tsx's ArticleUnlockPanel exactly (same processing/
// payment-required/done/error shape, same two-step-payment UI), but
// starts from "idle" rather than "locked" — there's nothing to hide
// here, a listing's own content is always public, this panel is purely
// the payment action. See server/cmd/dvm/main.go's
// handleListingPurchaseJob for what "done" actually means: a real,
// independently-verifiable NIP-32 receipt, not a change to the
// listing's own status (only the seller can do that — see the
// "Mark as sold" control below).
function BuyNowPanel({ event }: { event: NDKEvent }) {
  const [state, setState] = useState<BuyState>('idle')
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState('')
  const [amountSats, setAmountSats] = useState(0)
  const [payee, setPayee] = useState<'seller' | 'nostras'>('seller')
  const [receiptId, setReceiptId] = useState('')
  const [paying, setPaying] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cancelRef.current?.(), [])

  function handleBuy() {
    setState('requesting')
    setError('')
    cancelRef.current = requestListingPurchase(event.id, (update: DvmJobUpdate) => {
      if (update.status === 'processing') {
        setState('requesting')
      } else if (update.status === 'payment-required') {
        setInvoice(update.invoice)
        setAmountSats(Math.round(update.amountMsat / 1000))
        setPayee(update.payee === 'seller' ? 'seller' : 'nostras')
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

  function handleReset() {
    cancelRef.current?.()
    cancelRef.current = null
    setState('idle')
    setError('')
    setInvoice('')
  }

  return (
    <div className="article-unlock-panel">
      {state === 'idle' && (
        <button type="button" className="btn btn-primary" onClick={handleBuy}>
          Buy Now
        </button>
      )}

      {state === 'requesting' && <p className="field-hint">Confirming…</p>}

      {state === 'payment-required' && (
        <div className="stack">
          <p className="field-hint">
            {payee === 'seller' ? 'Step 1 of 2 — pay the seller' : "Step 2 of 2 — pay NOSTRAS's fee"}
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
        <p className="field-hint">
          Purchase confirmed — a public receipt was published (
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

function OwnerControls({ event, status, onSold }: { event: NDKEvent; status: 'active' | 'sold'; onSold: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleMarkSold() {
    setSaving(true)
    setError('')
    const result = await publishListingStatusUpdate(event, 'sold')
    if (result.ok) {
      onSold()
    } else {
      setError(result.error)
    }
    setSaving(false)
  }

  if (status === 'sold') {
    return <p className="field-hint">Marked sold.</p>
  }

  return (
    <div className="stack">
      <button type="button" className="btn btn-secondary btn-sm" onClick={handleMarkSold} disabled={saving}>
        {saving ? 'Saving…' : 'Mark as sold'}
      </button>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}

export function ListingView({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const activeUser = useActiveUser()
  const meta = parseListingMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const time = meta.publishedAt ?? event.created_at
  const isOwner = activeUser?.pubkey === event.pubkey
  // Overrides meta.status once the owner marks a listing sold in this
  // session — meta itself is derived from the `event` prop, which never
  // changes after a status update republishes a *new* event under the
  // same address; without this, the page's own status badge stayed
  // stuck on "active" even though OwnerControls' own text correctly
  // said "Marked sold." and the relay's real data was already updated.
  const [soldOverride, setSoldOverride] = useState(false)
  const status = soldOverride ? 'sold' : meta.status
  const priceLabel = meta.priceAmount
    ? `${meta.priceAmount} ${meta.priceCurrency}${meta.priceFrequency ? ` / ${meta.priceFrequency}` : ''}`
    : null

  return (
    <div className="article-view">
      <button type="button" className="dm-back-btn" onClick={() => setActiveView('home')} title="Back">
        <ArrowLeftIcon />
      </button>

      {meta.images.length > 0 && (
        <div className="listing-view-gallery">
          {meta.images
            .filter((img) => isSecureImageUrl(img.url))
            .map((img) => (
              <img key={img.url} className="listing-view-image" src={img.url} alt="" />
            ))}
        </div>
      )}

      <h1 className="article-view-title">{meta.title}</h1>

      <div className="listing-view-meta-row">
        {priceLabel && <span className="listing-view-price">{priceLabel}</span>}
        {meta.location && <span className="listing-view-location">{meta.location}</span>}
        <span className={`listing-status-badge listing-status-${status}`}>{status}</span>
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

      {isOwner ? (
        <OwnerControls event={event} status={status} onSold={() => setSoldOverride(true)} />
      ) : (
        <div className="stack">
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={() => startDmWith(event.pubkey)}>
              Contact seller
            </button>
            <ZapButton event={event} />
          </div>
          {status === 'active' && <BuyNowPanel event={event} />}
        </div>
      )}
    </div>
  )
}
