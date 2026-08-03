import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useProfile } from '../hooks/useProfile'
import { ZapButton } from './ZapButton'

function FeedItem({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const label = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`

  return (
    <li>
      <div>
        {profile?.picture && (
          <img src={profile.picture} alt="" width={24} height={24} />
        )}
        <strong>{label}</strong>
      </div>
      <p>{event.content}</p>
      <ZapButton event={event} />
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
    return <p>No notes yet.</p>
  }

  return (
    <ul>
      {events.map((event) => (
        <FeedItem key={event.id} event={event} />
      ))}
    </ul>
  )
}
