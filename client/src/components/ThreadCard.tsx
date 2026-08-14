import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { parseThreadMeta } from '../lib/forum'
import { formatRelativeTime } from '../lib/time'
import { viewThread } from '../lib/navigation'
import { MessageSquareIcon } from './icons'
import { NoteMenu } from './NoteMenu'

const SNIPPET_LIMIT = 200

export function ThreadCard({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const meta = parseThreadMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const snippet =
    event.content.length > SNIPPET_LIMIT
      ? `${event.content.slice(0, SNIPPET_LIMIT).trim()}…`
      : event.content

  return (
    <li className="feed-item article-card">
      {/* Same reasoning as ArticleCard's own menu placement — outside the
          card's own big clickable button, since a button can't nest
          inside a button. */}
      <div className="article-card-menu">
        <NoteMenu event={event} />
      </div>
      <button type="button" className="article-card-btn" onClick={() => viewThread(event)}>
        {/* NIP-7D has no cover-image field — always the generic fallback,
            matching ArticleCard's own no-image fallback treatment. */}
        <span className="article-card-image article-card-image-fallback">
          <MessageSquareIcon />
        </span>
        <div className="article-card-body">
          <div className="feed-item-meta">
            <span className="feed-item-name">{authorLabel}</span>
            {event.created_at && (
              <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>
            )}
          </div>
          <h3 className="article-card-title">{meta.title}</h3>
          {snippet && <p className="article-card-summary">{snippet}</p>}
        </div>
      </button>
    </li>
  )
}
