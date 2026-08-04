import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'

const NOTIFICATION_KINDS = [1, 6, 7, 9735]

// Live activity feed of things referencing the active user: replies/
// mentions (kind 1), reposts (kind 6), likes (kind 7), zap receipts
// (kind 9735). Stays subscribed for as long as the view is mounted, same
// as the home feed — no unread-count/badge tracking, just the list.
export function useNotifications() {
  const activeUser = useActiveUser()
  const [events, setEvents] = useState<NDKEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeUser) {
      setEvents([])
      setLoading(false)
      return
    }

    setEvents([])
    setLoading(true)

    const sub = ndk.subscribe({
      kinds: NOTIFICATION_KINDS,
      '#p': [activeUser.pubkey],
      limit: 50,
    })

    sub.on('event', (event: NDKEvent) => {
      // Skip self-notifications (e.g. liking/replying to your own note).
      if (event.pubkey === activeUser.pubkey) return
      setEvents((prev) => {
        if (prev.some((existing) => existing.id === event.id)) return prev
        return [event, ...prev].sort(
          (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
        )
      })
    })

    sub.on('eose', () => setLoading(false))

    return () => sub.stop()
  }, [activeUser])

  return { events, loading }
}
