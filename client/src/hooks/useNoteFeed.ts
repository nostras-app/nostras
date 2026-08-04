import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useRelayStatus } from './useRelayStatus'

// Subscribes to kind:1 notes — either the global feed (authors omitted) or
// a single author's notes (profile view). Shared here so both call sites
// get the same dedup/sort/eose/event:dup handling instead of two copies.
export function useNoteFeed(authors?: string[]) {
  const [events, setEvents] = useState<NDKEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [, forceUpdate] = useState(0)
  const { generation } = useRelayStatus()

  const authorsKey = authors?.join(',') ?? ''

  useEffect(() => {
    if (authors && authors.length === 0) {
      setEvents([])
      setLoading(false)
      return
    }

    setEvents([])
    setLoading(true)

    const sub = ndk.subscribe(
      authors ? { kinds: [1], authors, limit: 50 } : { kinds: [1], limit: 50 },
    )

    sub.on('event', (event: NDKEvent) => {
      setEvents((prev) => {
        if (prev.some((existing) => existing.id === event.id)) return prev
        return [event, ...prev].sort(
          (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
        )
      })
    })

    // eose = relays have sent everything they currently have; after this,
    // an empty list means "genuinely no notes", not "still loading".
    sub.on('eose', () => setLoading(false))

    // event:dup fires when a relay we're already subscribed to confirms an
    // event we already have — it's how event.onRelays grows over time.
    // Nothing about `events` itself changes, so force a re-render to pick
    // up the new count on the "seen on N relays" indicator.
    sub.on('event:dup', () => forceUpdate((n) => n + 1))

    return () => sub.stop()
    // authorsKey (not authors itself) is the real dependency: a plain array
    // prop gets a new reference every render, which would resubscribe on
    // every render even when the actual author list hasn't changed.
    // generation bumps only when the local relay recovers from a real
    // disconnect — see lib/relayStatus.ts — forcing a fresh REQ instead of
    // leaving a stale subscription that NDK never automatically resends.
  }, [authorsKey, generation])

  return { events, loading }
}
