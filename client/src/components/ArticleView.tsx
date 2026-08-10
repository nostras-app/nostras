import ReactMarkdown from 'react-markdown'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { parseArticleMeta } from '../lib/article'
import { formatRelativeTime } from '../lib/time'
import { setActiveView, viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { ArrowLeftIcon } from './icons'
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

export function ArticleView({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const meta = parseArticleMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const time = meta.publishedAt ?? event.created_at

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

      <div className="article-view-content">
        <ReactMarkdown components={markdownComponents}>{event.content}</ReactMarkdown>
      </div>
    </div>
  )
}
