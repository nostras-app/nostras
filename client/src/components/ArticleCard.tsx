import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { parseArticleMeta } from '../lib/article'
import { formatRelativeTime } from '../lib/time'
import { viewArticle } from '../lib/navigation'
import { FileTextIcon } from './icons'

export function ArticleCard({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const meta = parseArticleMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const time = meta.publishedAt ?? event.created_at

  return (
    <li className="feed-item article-card">
      <button type="button" className="article-card-btn" onClick={() => viewArticle(event)}>
        {meta.image ? (
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
          <h3 className="article-card-title">{meta.title}</h3>
          {meta.summary && <p className="article-card-summary">{meta.summary}</p>}
        </div>
      </button>
    </li>
  )
}
