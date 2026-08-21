import { useEffect, useMemo, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useRelayStatus } from '../hooks/useRelayStatus'
import { KIND_LISTING, parseListingMeta } from '../lib/listing'
import { ListingCard } from './ListingCard'
import { FeedSkeleton } from './Feed'

const EOSE_FALLBACK_MS = 12000

// A small, dedicated subscription — scoped to just kind:30402, not the
// broader kinds set useNoteFeed.ts subscribes to for the main feed —
// since a browse-only Marketplace destination has no reason to fetch
// notes/articles/polls/etc. just to filter them away. Same subscribe/
// dedupe/EOSE-fallback-timer shape as useNoteFeed.ts, without the
// hold-new-events/mute-exclusion machinery that view doesn't need here.
function useListingFeed() {
  const [events, setEvents] = useState<NDKEvent[]>([])
  const [loading, setLoading] = useState(true)
  const { generation } = useRelayStatus()

  useEffect(() => {
    setEvents([])
    setLoading(true)
    let stopped = false

    const sub = ndk.subscribe({ kinds: [KIND_LISTING], limit: 100 })

    sub.on('event', (event: NDKEvent) => {
      if (stopped) return
      setEvents((prev) => {
        if (prev.some((existing) => existing.id === event.id)) return prev
        return [event, ...prev].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
      })
    })
    sub.on('eose', () => {
      if (stopped) return
      setLoading(false)
    })

    const eoseFallback = setTimeout(() => {
      if (stopped) return
      setLoading(false)
    }, EOSE_FALLBACK_MS)

    return () => {
      stopped = true
      clearTimeout(eoseFallback)
      sub.stop()
    }
  }, [generation])

  return { events, loading }
}

export function MarketplaceView() {
  const { events, loading } = useListingFeed()
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  // Each listing is addressable (kind:30402) — a status edit republishes
  // the same (kind, pubkey, d), so keep only the newest copy per address
  // rather than showing a stale "active" card alongside its own "sold"
  // replacement.
  const latestByAddress = useMemo(() => {
    const byAddress = new Map<string, NDKEvent>()
    for (const event of events) {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
      const address = `${event.pubkey}:${dTag}`
      const existing = byAddress.get(address)
      if (!existing || (event.created_at ?? 0) > (existing.created_at ?? 0)) {
        byAddress.set(address, event)
      }
    }
    return [...byAddress.values()].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
  }, [events])

  const active = latestByAddress.filter((e) => parseListingMeta(e).status === 'active')

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const event of active) {
      for (const c of parseListingMeta(event).categories) set.add(c)
    }
    return [...set].sort()
  }, [active])

  const visible = categoryFilter
    ? active.filter((e) => parseListingMeta(e).categories.includes(categoryFilter))
    : active

  if (loading) {
    return <FeedSkeleton />
  }

  return (
    <div className="marketplace-view">
      {categories.length > 0 && (
        <div className="feed-tabs marketplace-category-filter" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={categoryFilter === null}
            className={`feed-tab${categoryFilter === null ? ' feed-tab-active' : ''}`}
            onClick={() => setCategoryFilter(null)}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={categoryFilter === c}
              className={`feed-tab${categoryFilter === c ? ' feed-tab-active' : ''}`}
              onClick={() => setCategoryFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="feed-empty">
          <p>No listings yet.</p>
          <p className="feed-empty-hint">Publish one from Compose &gt; Listing.</p>
        </div>
      ) : (
        <ul className="feed">
          {visible.map((event) => (
            <ListingCard key={event.id} event={event} />
          ))}
        </ul>
      )}
    </div>
  )
}
