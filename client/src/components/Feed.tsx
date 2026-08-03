import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

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
        <li key={event.id}>
          <div>{event.author.npub.slice(0, 12)}…</div>
          <p>{event.content}</p>
        </li>
      ))}
    </ul>
  )
}
