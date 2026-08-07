import ReactMarkdown from 'react-markdown'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { parseArticleMeta } from '../lib/article'
import { formatRelativeTime } from '../lib/time'
import { setActiveView, viewProfile } from '../lib/navigation'
import { ArrowLeftIcon } from './icons'
import { NoteMenu } from './NoteMenu'

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

      {meta.image && <img className="article-view-image" src={meta.image} alt="" />}

      <h1 className="article-view-title">{meta.title}</h1>

      <div className="article-view-author-row">
        <button type="button" className="article-view-author" onClick={() => viewProfile(event.pubkey)}>
          {profile?.picture ? (
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
        <ReactMarkdown>{event.content}</ReactMarkdown>
      </div>
    </div>
  )
}
