import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useShowMeta } from '../hooks/useShowMeta'
import { parseEpisodeMeta } from '../lib/podcast'
import { formatRelativeTime } from '../lib/time'
import { viewEpisode } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { LockIcon, MicIcon } from './icons'
import { NoteMenu } from './NoteMenu'

export function PodcastEpisodeCard({ event }: { event: NDKEvent }) {
  const show = useShowMeta(event.pubkey)
  const meta = parseEpisodeMeta(event.tags)
  // Episode art falls back to the show's own cover, matching the
  // spec's own framing of episode image as optional.
  const artUrl = meta.image || show?.image || ''

  return (
    <li className="feed-item article-card">
      <div className="article-card-menu">
        <NoteMenu event={event} />
      </div>
      <button type="button" className="article-card-btn" onClick={() => viewEpisode(event)}>
        {isSecureImageUrl(artUrl) ? (
          <img className="article-card-image" src={artUrl} alt="" />
        ) : (
          <span className="article-card-image article-card-image-fallback">
            <MicIcon />
          </span>
        )}
        <div className="article-card-body">
          <div className="feed-item-meta">
            <span className="feed-item-name">{show?.title || 'Podcast episode'}</span>
            {event.created_at && (
              <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>
            )}
          </div>
          <h3 className="article-card-title">
            {meta.encrypted && <LockIcon className="article-card-lock" />}
            {meta.title}
          </h3>
          {meta.description && <p className="article-card-summary">{meta.description}</p>}
        </div>
      </button>
    </li>
  )
}
