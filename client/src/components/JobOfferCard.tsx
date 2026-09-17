import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { parseJobMeta } from '../lib/job'
import { formatRelativeTime } from '../lib/time'
import { viewProfile, viewJobOffer } from '../lib/navigation'
import { NoteMenu } from './NoteMenu'

// Job board offer card — the feed/board-grid summary, same header
// template (author row + NoteMenu) every other card type in this app
// shares (ArticleCard, ListingCard, PollCard, ThreadCard, ZapGoalCard,
// PodcastEpisodeCard).
export function JobOfferCard({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const meta = parseJobMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const rewardLabel = meta.rewardAmount ? `${meta.rewardAmount} ${meta.rewardCurrency}` : null

  return (
    <li className="feed-item listing-card">
      <div className="feed-item-meta">
        <button type="button" className="feed-item-name-btn" onClick={() => viewProfile(event.pubkey)}>
          <span className="feed-item-name">{authorLabel}</span>
        </button>
        {event.created_at && <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>}
        <NoteMenu event={event} />
      </div>

      <button type="button" className="listing-card-body" onClick={() => viewJobOffer(event)}>
        <div className="listing-card-info">
          <h3 className="listing-card-title">{meta.title}</h3>
          <div className="listing-card-meta-row">
            {rewardLabel && <span className="listing-card-price">{rewardLabel}</span>}
            <span className={`listing-status-badge listing-status-${meta.status === 'paid' ? 'sold' : 'active'}`}>
              {meta.status}
            </span>
          </div>
        </div>
      </button>
    </li>
  )
}
