import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useNoteFeed } from '../hooks/useNoteFeed'
import { useFollowing } from '../hooks/useFollowing'
import { formatRelativeTime } from '../lib/time'
import { viewProfile } from '../lib/navigation'
import { NoteContent } from './NoteContent'
import { EngagementBar } from './EngagementBar'
import { ArticleCard } from './ArticleCard'

// Branches on event.kind here (not at each call site) so every place
// that already renders FeedItem — the global/following feed, search
// results, bookmarks, a profile's own notes — automatically gets article
// cards mixed in for kind:30023 events too, no separate call needed.
export function FeedItem({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const label = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`

  if (event.kind === 30023) {
    return <ArticleCard event={event} />
  }

  return (
    <li className="feed-item">
      <button
        type="button"
        className="feed-item-avatar-btn"
        onClick={() => viewProfile(event.pubkey)}
        title={`View ${label}'s profile`}
      >
        {profile?.picture ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <span className="avatar-fallback">{label.charAt(0)}</span>
        )}
      </button>
      <div className="feed-item-body">
        <div className="feed-item-meta">
          <button
            type="button"
            className="feed-item-name-btn"
            onClick={() => viewProfile(event.pubkey)}
          >
            <span className="feed-item-name">{label}</span>
          </button>
          {event.created_at && (
            <span className="feed-item-time">
              {formatRelativeTime(event.created_at)}
            </span>
          )}
        </div>
        <NoteContent content={event.content} />
        <div className="feed-item-footer">
          <EngagementBar event={event} />
        </div>
      </div>
    </li>
  )
}

export function FeedSkeleton() {
  return (
    <ul className="feed">
      {[0, 1, 2].map((i) => (
        <li key={i} className="feed-item feed-item-skeleton">
          <span className="skeleton skeleton-avatar" />
          <div className="feed-item-body">
            <span className="skeleton skeleton-line" style={{ width: '30%' }} />
            <span className="skeleton skeleton-line" style={{ width: '90%' }} />
            <span className="skeleton skeleton-line" style={{ width: '60%' }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

type FeedMode = 'global' | 'following'
const FEED_MODE_KEY = 'nostras:feed-mode'

function loadFeedMode(): FeedMode {
  return localStorage.getItem(FEED_MODE_KEY) === 'following' ? 'following' : 'global'
}

export function Feed() {
  const [mode, setMode] = useState<FeedMode>(loadFeedMode)
  const { pubkeys: followingPubkeys, loading: followingLoading } = useFollowing()

  useEffect(() => {
    localStorage.setItem(FEED_MODE_KEY, mode)
  }, [mode])

  const { events, loading } = useNoteFeed(mode === 'following' ? followingPubkeys : undefined)

  function renderBody() {
    if (mode === 'following' && !followingLoading && followingPubkeys.length === 0) {
      return (
        <div className="feed-empty">
          <p>You're not following anyone yet.</p>
          <p className="feed-empty-hint">
            Visit a profile and hit Follow to see their notes here.
          </p>
        </div>
      )
    }

    if (loading && events.length === 0) {
      return <FeedSkeleton />
    }

    if (events.length === 0) {
      return (
        <div className="feed-empty">
          <p>No notes yet.</p>
          <p className="feed-empty-hint">
            {mode === 'following' ? 'None of the people you follow have posted yet.' : 'Be the first to post something.'}
          </p>
        </div>
      )
    }

    return (
      <ul className="feed">
        {events.map((event) => (
          <FeedItem key={event.id} event={event} />
        ))}
      </ul>
    )
  }

  return (
    <div className="feed-view">
      <div className="feed-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'following'}
          className={`feed-tab${mode === 'following' ? ' feed-tab-active' : ''}`}
          onClick={() => setMode('following')}
        >
          Following
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'global'}
          className={`feed-tab${mode === 'global' ? ' feed-tab-active' : ''}`}
          onClick={() => setMode('global')}
        >
          Global
        </button>
      </div>
      {renderBody()}
    </div>
  )
}
