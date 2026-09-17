import { useEffect, useMemo, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useRelayStatus } from '../hooks/useRelayStatus'
import { KIND_JOB_OFFER, parseJobMeta } from '../lib/job'
import { JobOfferCard } from './JobOfferCard'
import { FeedSkeleton } from './Feed'

const EOSE_FALLBACK_MS = 12000

// Same shape as MarketplaceView.tsx's useListingFeed — a small, dedicated
// subscription scoped to just kind:30406, not the broader kinds set
// useNoteFeed.ts subscribes to for the main feed.
function useJobFeed() {
  const [events, setEvents] = useState<NDKEvent[]>([])
  const [loading, setLoading] = useState(true)
  const { generation } = useRelayStatus()

  useEffect(() => {
    setEvents([])
    setLoading(true)
    let stopped = false

    const sub = ndk.subscribe({ kinds: [KIND_JOB_OFFER], limit: 100 })

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

export function JobBoardView() {
  const { events, loading } = useJobFeed()
  const [categoryFilter, setCategoryFilter] = useState('')

  // Addressable (kind:30406) — a status edit republishes the same
  // (kind, pubkey, d), so keep only the newest copy per address rather
  // than showing a stale "open" card alongside its own "paid" replacement.
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

  const open = latestByAddress.filter((e) => parseJobMeta(e).status === 'open')

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const event of open) {
      for (const c of parseJobMeta(event).categories) set.add(c)
    }
    return [...set].sort()
  }, [open])

  const visible = useMemo(() => {
    if (!categoryFilter) return open
    return open.filter((e) => parseJobMeta(e).categories.includes(categoryFilter))
  }, [open, categoryFilter])

  // Same top-of-view explainer convention as SearchView/AskClaudeCard —
  // shown unconditionally, including while still loading, since it's
  // orientation text about the feature itself, not feed content.
  const hint = (
    <p className="field-hint">
      Job Board: post a paid job, people apply by commenting on it
      (NIP-22), and you pick who gets paid — completion payment settles
      over Lightning through a NIP-90 DVM job, plus a small flat NOSTRAS
      relay fee. The job offer itself is a NOSTRAS-specific event kind,
      not a ratified NIP, so it won't render in other Nostr clients —
      share the app.nostras.app link if you want people elsewhere to
      see it.
    </p>
  )

  if (loading) {
    return (
      <div className="marketplace-view">
        {hint}
        <FeedSkeleton />
      </div>
    )
  }

  return (
    <div className="marketplace-view">
      {hint}
      {open.length > 0 && categories.length > 0 && (
        <div className="field-row marketplace-filter-row">
          <select
            className="input"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by skill tag"
          >
            <option value="">All skill tags</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="feed-empty">
          <p>{open.length === 0 ? 'No open jobs yet.' : 'No jobs match your filter.'}</p>
          <p className="feed-empty-hint">
            {open.length === 0 ? (
              <>Post one from Compose &gt; Job.</>
            ) : (
              <button type="button" className="link-btn" onClick={() => setCategoryFilter('')}>
                Clear filter
              </button>
            )}
          </p>
        </div>
      ) : (
        <ul className="feed">
          {visible.map((event) => (
            <JobOfferCard key={event.id} event={event} />
          ))}
        </ul>
      )}
    </div>
  )
}
