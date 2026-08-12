import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { parseArticleMeta } from '../lib/article'
import { formatRelativeTime } from '../lib/time'
import { setActiveView, viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import {
  fetchDvmArticleEncryptionPubkey,
  requestArticleUnlock,
  type ArticleUnlockUpdate,
} from '../lib/paidArticles'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { ArrowLeftIcon, LockIcon } from './icons'
import { NoteMenu } from './NoteMenu'
import type { Components } from 'react-markdown'

// react-markdown's own `![alt](url)` image syntax renders a real <img>
// regardless of scheme by default — a separate gap from meta.image above
// (that only guards the article's own cover-image field, not the body
// content, which is arbitrary author-controlled markdown). Same
// mixed-content principle as parseContent.ts's isSecureImageUrl: an
// insecure src falls back to a plain link instead of a real <img> element.
const markdownComponents: Components = {
  img: ({ src, alt }) =>
    isSecureImageUrl(src) ? (
      <img src={src} alt={alt ?? ''} />
    ) : (
      <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer">
        {alt || src}
      </a>
    ),
}

type UnlockState = 'locked' | 'requesting' | 'payment-required' | 'error'

// Shown instead of the real body for a paid article until it's actually
// unlocked — same processing/payment-required/error state shape as
// TranslateButton.tsx (reusing that established pattern), but starting
// from "locked" rather than "idle" since the locked state itself is
// what replaces the content here, not an icon that opens a picker.
function ArticleUnlockPanel({
  event,
  priceSats,
  onUnlocked,
}: {
  event: NDKEvent
  priceSats: number | null
  onUnlocked: (plaintext: string) => void
}) {
  const [state, setState] = useState<UnlockState>('locked')
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState('')
  const [amountSats, setAmountSats] = useState(priceSats ?? 0)
  // Which of the two sequential payments this payment-required event is
  // for — see lib/paidArticles.ts's own comment on why an unlock job now
  // produces two of these in a row (the article's price, paid directly
  // to the author, then NOSTRAS's own small flat service fee).
  const [payee, setPayee] = useState<'author' | 'nostras'>('author')
  const [paying, setPaying] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cancelRef.current?.(), [])

  async function handleUnlock() {
    setState('requesting')
    setError('')
    try {
      const dvmPubkey = await fetchDvmArticleEncryptionPubkey()
      if (!dvmPubkey) {
        setError('Paid articles are not available right now — the DVM has not advertised an encryption key. Try again later.')
        setState('error')
        return
      }
      cancelRef.current = requestArticleUnlock({
        articleEventId: event.id,
        dvmPubkey,
        onUpdate: (update: ArticleUnlockUpdate) => {
          if (update.status === 'processing') {
            setState('requesting')
          } else if (update.status === 'payment-required') {
            setInvoice(update.invoice)
            setAmountSats(Math.round(update.amountMsat / 1000))
            setPayee(update.payee)
            setState('payment-required')
          } else if (update.status === 'done') {
            onUnlocked(update.content)
          } else if (update.status === 'error') {
            setError(update.message)
            setState('error')
          }
        },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start unlock request')
      setState('error')
    }
  }

  async function handlePayWithWallet() {
    const nwcUri = getSavedNwcUri()
    if (!nwcUri) return
    setPaying(true)
    try {
      await payInvoiceWithNwc(nwcUri, invoice)
      // The DVM publishes "processing" once it observes settlement, then
      // the (decrypted, client-side) result — onUpdate above carries us
      // the rest of the way.
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
    setState('locked')
    setError('')
    setInvoice('')
  }

  return (
    <div className="article-unlock-panel">
      <LockIcon />
      <p className="field-hint">
        This article is paywalled —{' '}
        {priceSats ? <strong>{priceSats.toLocaleString()} sats</strong> : 'a set price'} paid
        directly to its author, plus a small flat fee to NOSTRAS for running the unlock service
        (that fee is not end-to-end: our DVM holds the decryption key and reads the plaintext to
        serve it to whoever pays; the author's own share never passes through our wallet). And
        like any paywall — once unlocked, nothing technical stops a reader from sharing what they
        read further.
      </p>

      {state === 'locked' && (
        <button type="button" className="btn btn-primary" onClick={handleUnlock}>
          Unlock{priceSats ? ` for ${priceSats.toLocaleString()} sats` : ''}
        </button>
      )}

      {state === 'requesting' && <p className="field-hint">Unlocking…</p>}

      {state === 'payment-required' && (
        <div className="stack">
          <p className="field-hint">
            {payee === 'author' ? 'Step 1 of 2 — pay the author' : 'Step 2 of 2 — pay NOSTRAS\'s fee'}
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

export function ArticleView({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const meta = parseArticleMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const time = meta.publishedAt ?? event.created_at
  const [unlockedContent, setUnlockedContent] = useState<string | null>(null)

  const locked = meta.encrypted && unlockedContent === null

  return (
    <div className="article-view">
      <button type="button" className="dm-back-btn" onClick={() => setActiveView('home')} title="Back">
        <ArrowLeftIcon />
      </button>

      {isSecureImageUrl(meta.image) && <img className="article-view-image" src={meta.image} alt="" />}

      <h1 className="article-view-title">{meta.title}</h1>

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

      {locked ? (
        <ArticleUnlockPanel event={event} priceSats={meta.priceSats} onUnlocked={setUnlockedContent} />
      ) : (
        <div className="article-view-content">
          <ReactMarkdown components={markdownComponents}>
            {meta.encrypted ? (unlockedContent ?? '') : event.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}
