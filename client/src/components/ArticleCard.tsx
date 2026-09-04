import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { parseArticleMeta } from '../lib/article'
import { formatRelativeTime } from '../lib/time'
import { viewArticle } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { FileTextIcon, LockIcon } from './icons'
import { NoteMenu } from './NoteMenu'
import { EngagementBar } from './EngagementBar'

export function ArticleCard({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const meta = parseArticleMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const time = meta.publishedAt ?? event.created_at

  return (
    <li className="feed-item article-card">
      {/* Real gap reported by the user (2026-08-07): articles had no menu
          at all -- no way to copy a link, view the raw event, or (the
          specific case that surfaced this) rebroadcast an already-
          published article after opting a new relay into this session's
          publish targets. Kept outside the card's own big clickable
          button below, since a button can't nest inside a button. */}
      <div className="article-card-menu">
        <NoteMenu event={event} />
      </div>
      <button type="button" className="article-card-btn" onClick={() => viewArticle(event)}>
        {isSecureImageUrl(meta.image) ? (
          <img className="article-card-image" src={meta.image} alt="" />
        ) : (
          <span className="article-card-image article-card-image-fallback">
            <FileTextIcon />
          </span>
        )}
        <div className="article-card-body">
          <div className="feed-item-meta">
            <span className="feed-item-name">{authorLabel}</span>
            {time && <span className="feed-item-time">{formatRelativeTime(time)}</span>}
          </div>
          <h3 className="article-card-title">
            {meta.encrypted && <LockIcon className="article-card-lock" />}
            {meta.title}
          </h3>
          {meta.summary && <p className="article-card-summary">{meta.summary}</p>}
        </div>
      </button>
      <div className="feed-item-footer">
        <EngagementBar event={event} showReply={false} showNoteMenu={false} />
      </div>
    </li>
  )
}
