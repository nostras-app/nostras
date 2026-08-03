import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useProfile } from '../hooks/useProfile'
import { formatRelativeTime } from '../lib/time'
import { NoteContent } from './NoteContent'
import { EngagementBar } from './EngagementBar'

function FeedItem({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const label = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`

  return (
    <li className="feed-item">
      {profile?.picture ? (
        <img className="avatar" src={profile.picture} alt="" />
      ) : (
        <span className="avatar-fallback">{label.charAt(0)}</span>
      )}
      <div className="feed-item-body">
        <div className="feed-item-meta">
          <span className="feed-item-name">{label}</span>
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

function FeedSkeleton() {
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

export function Feed() {
  const [events, setEvents] = useState<NDKEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sub = ndk.subscribe({ kinds: [1], limit: 50 })

    sub.on('event', (event: NDKEvent) => {
      setEvents((prev) => {
        if (prev.some((existing) => existing.id === event.id)) return prev
        return [event, ...prev].sort(
          (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
        )
      })
    })

    // eose = relays have sent everything they currently have; after this,
    // an empty list means "genuinely no notes yet", not "still loading".
    sub.on('eose', () => setLoading(false))

    return () => sub.stop()
  }, [])

  if (loading && events.length === 0) {
    return <FeedSkeleton />
  }

  if (events.length === 0) {
    return (
      <div className="feed-empty">
        <p>No notes yet.</p>
        <p className="feed-empty-hint">Be the first to post something.</p>
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
