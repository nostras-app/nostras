import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useShowMeta } from '../hooks/useShowMeta'
import { parseEpisodeMeta, parseEncryptedAudioPayload } from '../lib/podcast'
import { formatRelativeTime } from '../lib/time'
import { setActiveView, viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import {
  fetchDvmArticleEncryptionPubkey,
  requestArticleUnlock,
  type ArticleUnlockUpdate,
} from '../lib/paidArticles'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { ArrowLeftIcon, LockIcon, MicIcon } from './icons'
import { NoteMenu } from './NoteMenu'
import { EngagementBar } from './EngagementBar'
import { CommentSection } from './CommentSection'

// Same insecure-image guard as ArticleView's own markdown renderer —
// react-markdown's `![alt](url)` syntax renders a real <img> regardless
// of scheme by default; an insecure src falls back to a plain link.
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

// Mirrors ArticleView's own ArticleUnlockPanel almost exactly — same
// state machine, same requestArticleUnlock() call (reused as-is, it's
// generic over which event id it unlocks despite the article-flavored
// name; see lib/paidArticles.ts and lib/podcast.ts's own comments). The
// only real difference: the decrypted plaintext here is a small JSON
// blob ({url, type}) rather than markdown, so onUnlocked hands back the
// parsed audio URL/type instead of raw text.
function EpisodeUnlockPanel({
  event,
  priceSats,
  onUnlocked,
}: {
  event: NDKEvent
  priceSats: number | null
  onUnlocked: (audio: { url: string; type: string }) => void
}) {
  const [state, setState] = useState<UnlockState>('locked')
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState('')
  const [amountSats, setAmountSats] = useState(priceSats ?? 0)
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
        setError('Paid episodes are not available right now — the DVM has not advertised an encryption key. Try again later.')
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
            onUnlocked(parseEncryptedAudioPayload(update.content))
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
        This episode is paywalled —{' '}
        {priceSats ? <strong>{priceSats.toLocaleString()} sats</strong> : 'a set price'} paid
        directly to its host, plus a small flat fee to NOSTRAS for running the unlock service
        (that fee is not end-to-end: our DVM holds the decryption key and reads the audio URL to
        serve it to whoever pays; the host's own share never passes through our wallet). And like
        any paywall — once unlocked, nothing technical stops a listener from sharing it further.
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
            {payee === 'author' ? 'Step 1 of 2 — pay the host' : 'Step 2 of 2 — pay NOSTRAS\'s fee'}
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

// NIP-F4 podcast episode reading view — mirrors ArticleView's shell
// (back button, author/show row + menu, then content, then replies).
// Replies reuse the same NIP-22 comment infrastructure NIP-7D threads
// and NIP-23 articles already share — kind:54 is a regular
// (non-addressable) event, so lib/comments.ts's isAddressableKind
// branch automatically uses E/e tags here with no changes needed.
export function PodcastEpisodeView({ event }: { event: NDKEvent }) {
  const show = useShowMeta(event.pubkey)
  const meta = parseEpisodeMeta(event.tags)
  const artUrl = meta.image || show?.image || ''
  const [unlockedAudio, setUnlockedAudio] = useState<{ url: string; type: string } | null>(null)
  const locked = meta.encrypted && unlockedAudio === null
  const audioUrl = meta.encrypted ? unlockedAudio?.url ?? '' : meta.audioUrl

  return (
    <div className="article-view">
      <button type="button" className="dm-back-btn" onClick={() => setActiveView('home')} title="Back">
        <ArrowLeftIcon />
      </button>

      {isSecureImageUrl(artUrl) && <img className="article-view-image" src={artUrl} alt="" />}

      <h1 className="article-view-title">{meta.title}</h1>

      <div className="article-view-author-row">
        <button type="button" className="article-view-author" onClick={() => viewProfile(event.pubkey)}>
          {isSecureImageUrl(show?.image) ? (
            <img className="avatar" src={show?.image} alt="" />
          ) : (
            <span className="avatar-fallback">
              <MicIcon />
            </span>
          )}
          <span className="feed-item-name">{show?.title || 'Podcast episode'}</span>
          {event.created_at && (
            <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>
          )}
        </button>
        <NoteMenu event={event} />
      </div>

      {meta.description && <p className="field-hint">{meta.description}</p>}

      {locked ? (
        <EpisodeUnlockPanel event={event} priceSats={meta.priceSats} onUnlocked={setUnlockedAudio} />
      ) : (
        <>
          {audioUrl && (
            <audio className="podcast-audio-player" controls src={audioUrl}>
              Your browser doesn't support inline audio —{' '}
              <a href={audioUrl} target="_blank" rel="noopener noreferrer">
                open the episode directly
              </a>
              .
            </audio>
          )}

          <div className="feed-item-footer">
            <EngagementBar event={event} showReply={false} showNoteMenu={false} />
          </div>

          {!meta.encrypted && event.content && (
            <div className="article-view-content">
              <ReactMarkdown components={markdownComponents}>{event.content}</ReactMarkdown>
            </div>
          )}

          <CommentSection rootEvent={event} />
        </>
      )}
    </div>
  )
}
