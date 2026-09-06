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
  // '' means "All" — matches a <select>'s own natural empty-option value,
  // simpler than a separate null sentinel now that this is a dropdown
  // instead of a row of tab buttons.
  const [categoryFilter, setCategoryFilter] = useState('')
  const [searchText, setSearchText] = useState('')

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

  // Category (exact match against a listing's own "t" tags) and free-text
  // search (substring match against title/description/categories) combine
  // with AND — picking a category narrows the pool, typing further
  // narrows within it, matching how category+search filters normally
  // compose on any marketplace/shopping UI.
  const visible = useMemo(() => {
    const needle = searchText.trim().toLowerCase()
    return active.filter((e) => {
      const meta = parseListingMeta(e)
      if (categoryFilter && !meta.categories.includes(categoryFilter)) return false
      if (needle) {
        const haystack = [meta.title, meta.description, ...meta.categories].join(' ').toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [active, categoryFilter, searchText])

  if (loading) {
    return <FeedSkeleton />
  }

  return (
    <div className="marketplace-view">
      {active.length > 0 && (
        <div className="field-row marketplace-filter-row">
          <select
            className="input"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="input marketplace-search-input"
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search listings…"
            aria-label="Search listings"
          />
        </div>
      )}

      {visible.length === 0 ? (
        <div className="feed-empty">
          <p>{active.length === 0 ? 'No listings yet.' : 'No listings match your filter.'}</p>
          <p className="feed-empty-hint">
            {active.length === 0 ? (
              <>Publish one from Compose &gt; Listing.</>
            ) : (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setCategoryFilter('')
                  setSearchText('')
                }}
              >
                Clear filters
              </button>
            )}
          </p>
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
