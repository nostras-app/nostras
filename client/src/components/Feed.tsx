import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useNoteFeed } from '../hooks/useNoteFeed'
import { useFollowing } from '../hooks/useFollowing'
import { useReferencedNote } from '../hooks/useReferencedNote'
import { formatRelativeTime } from '../lib/time'
import { viewProfile } from '../lib/navigation'
import { getReplyToEventId } from '../lib/nip10'
import { isSecureImageUrl } from '../lib/parseContent'
import { getContentWarningReason } from '../lib/contentWarning'
import { NoteContent } from './NoteContent'
import { EngagementBar } from './EngagementBar'
import { ArticleCard } from './ArticleCard'
import { ZapGoalCard } from './ZapGoalCard'
import { ReplyIcon } from './icons'

// Real user-reported gap (2026-08-07): replies rendered as ordinary,
// standalone notes with nothing indicating what they were replying to —
// this app has no threaded view yet (just a reply count on the original),
// so a reply floating in a feed with no context read as a non-sequitur.
// This doesn't build full threading, just a lightweight "Replying to
// <author>: <snippet>" line above the reply's own content, linking to the
// parent author's profile — the smallest fix that actually answers "which
// note was this a reply to."
function ReplyContext({ replyToId }: { replyToId: string }) {
  const parent = useReferencedNote(replyToId)
  const parentProfile = useProfile(parent?.pubkey)

  if (!parent) {
    // Still resolving (or genuinely unfindable — same ambiguity
    // useReferencedNote already accepts) — a static line rather than a
    // skeleton, since this is a small secondary detail, not the note's
    // own content.
    return (
      <div className="feed-item-reply-context">
        <ReplyIcon /> Replying to a note…
      </div>
    )
  }

  const parentLabel =
    parentProfile?.name || parentProfile?.displayName || `${parent.author.npub.slice(0, 12)}…`
  const snippet =
    parent.content.length > 80 ? `${parent.content.slice(0, 80).trim()}…` : parent.content

  return (
    <button
      type="button"
      className="feed-item-reply-context feed-item-reply-context-btn"
      onClick={() => viewProfile(parent.pubkey)}
    >
      <ReplyIcon />
      <span>
        Replying to <strong>{parentLabel}</strong>
        {snippet && <span className="feed-item-reply-context-snippet">: “{snippet}”</span>}
      </span>
    </button>
  )
}

// Branches on event.kind here (not at each call site) so every place
// that already renders FeedItem — the global/following feed, search
// results, bookmarks, a profile's own notes — automatically gets article
// cards and zap goal cards mixed in for kind:30023/9041 events too, no
// separate call needed.
export function FeedItem({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const label = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const replyToId = getReplyToEventId(event.tags)

  if (event.kind === 30023) {
    return <ArticleCard event={event} />
  }

  if (event.kind === 9041) {
    return <ZapGoalCard event={event} />
  }

  return (
    <li className="feed-item">
      <button
        type="button"
        className="feed-item-avatar-btn"
        onClick={() => viewProfile(event.pubkey)}
        title={`View ${label}'s profile`}
      >
        {isSecureImageUrl(profile?.picture) ? (
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
        {replyToId && <ReplyContext replyToId={replyToId} />}
        <NoteContent content={event.content} contentWarning={getContentWarningReason(event.tags)} tags={event.tags} />
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
