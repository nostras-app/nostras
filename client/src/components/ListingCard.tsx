import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { parseListingMeta } from '../lib/listing'
import { formatRelativeTime } from '../lib/time'
import { viewProfile, viewListing } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { NoteMenu } from './NoteMenu'

// NIP-99 classified listing card — the feed/marketplace-grid summary,
// same header template (author row + NoteMenu) every other card type in
// this app shares (ArticleCard, PollCard, ThreadCard, ZapGoalCard,
// PodcastEpisodeCard).
export function ListingCard({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const meta = parseListingMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const firstImage = meta.images.find((img) => isSecureImageUrl(img.url))
  const priceLabel = meta.priceAmount
    ? `${meta.priceAmount} ${meta.priceCurrency}${meta.priceFrequency ? ` / ${meta.priceFrequency}` : ''}`
    : null

  return (
    <li className="feed-item listing-card">
      <div className="feed-item-meta">
        <button type="button" className="feed-item-name-btn" onClick={() => viewProfile(event.pubkey)}>
          <span className="feed-item-name">{authorLabel}</span>
        </button>
        {event.created_at && <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>}
        <NoteMenu event={event} />
      </div>

      <button type="button" className="listing-card-body" onClick={() => viewListing(event)}>
        {firstImage && <img className="listing-card-image" src={firstImage.url} alt="" />}
        <div className="listing-card-info">
          <h3 className="listing-card-title">{meta.title}</h3>
          <div className="listing-card-meta-row">
            {priceLabel && <span className="listing-card-price">{priceLabel}</span>}
            {meta.location && <span className="listing-card-location">{meta.location}</span>}
            <span className={`listing-status-badge listing-status-${meta.status}`}>{meta.status}</span>
          </div>
        </div>
      </button>
    </li>
  )
}
