import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useProfile } from '../hooks/useProfile'
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
        <span className="feed-item-name">{label}</span>
        <NoteContent content={event.content} />
        <div className="feed-item-footer">
          <EngagementBar event={event} />
        </div>
      </div>
    </li>
  )
}

export function Feed() {
  const [events, setEvents] = useState<NDKEvent[]>([])

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

    return () => sub.stop()
  }, [])

  if (events.length === 0) {
    return <p className="feed-empty">No notes yet.</p>
  }

  return (
    <ul className="feed">
      {events.map((event) => (
        <FeedItem key={event.id} event={event} />
      ))}
    </ul>
  )
}
