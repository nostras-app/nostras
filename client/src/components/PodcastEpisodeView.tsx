import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useShowMeta } from '../hooks/useShowMeta'
import { parseEpisodeMeta } from '../lib/podcast'
import { formatRelativeTime } from '../lib/time'
import { setActiveView, viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { ArrowLeftIcon, MicIcon } from './icons'
import { NoteMenu } from './NoteMenu'
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

      {meta.audioUrl && (
        <audio className="podcast-audio-player" controls src={meta.audioUrl}>
          Your browser doesn't support inline audio —{' '}
          <a href={meta.audioUrl} target="_blank" rel="noopener noreferrer">
            open the episode directly
          </a>
          .
        </audio>
      )}

      {meta.description && <p className="field-hint">{meta.description}</p>}

      {event.content && (
        <div className="article-view-content">
          <ReactMarkdown components={markdownComponents}>{event.content}</ReactMarkdown>
        </div>
      )}

      <CommentSection rootEvent={event} />
    </div>
  )
}
