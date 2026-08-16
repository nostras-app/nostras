import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, authorQueryRelaySet } from '../lib/ndk'
import { useActiveUser } from '../hooks/useActiveUser'
import { withTimeout } from '../lib/podcast'
import { FeedItem, FeedSkeleton } from './Feed'

// Same missing-timeout bug class already found and fixed repeatedly
// elsewhere in this codebase (remoteSigner.ts, SearchView.tsx,
// paidArticles.ts, the six long-lived-subscription hooks, etc.) — real,
// not hypothetical here too: neither ndk.fetchEvent() nor
// ndk.fetchEvents() below ever had an explicit timeout, so a slow or
// stuck relay round trip left `loading` stuck true forever with zero
// error surfaced, matching a real user report of the skeleton never
// resolving.
const BOOKMARKS_TIMEOUT_MS = 8000

export function BookmarksView({ active }: { active: boolean }) {
  const activeUser = useActiveUser()
  const [events, setEvents] = useState<NDKEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active || !activeUser) return
    const user = activeUser
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        // Fetch fresh every time this tab is opened rather than once on
        // mount — the view stays mounted (like every other tab here) so
        // a one-shot fetch would go stale after bookmarking/
        // unbookmarking a note elsewhere in the app.
        //
        // Scoped to authorQueryRelaySet — same unscoped-authors-filter
        // bug class already found and fixed in useFollowing/
        // useFollowCounts/useNoteFeed/useProfile (see
        // authorQueryRelaySet's own comment in lib/ndk.ts). Without an
        // explicit relay set, this fetchEvent races NDK's own
        // CONNECTED-only relay fallback and can resolve to an empty/
        // stale answer — real bug, not hypothetical (2026-08-10): a
        // user with a real, previously-confirmed bookmark list saw "No
        // bookmarks yet" after a normal reload, not after any cache
        // clear.
        const list = await withTimeout(
          ndk.fetchEvent({ kinds: [10003], authors: [user.pubkey] }, undefined, authorQueryRelaySet),
          BOOKMARKS_TIMEOUT_MS,
          'Timed out loading your bookmark list',
        )
        if (cancelled) return

        // Most-recently-bookmarked first — toggle appends new bookmarks
        // to the end of the tag list, so reverse it rather than sorting
        // by the note's own publish date.
        const ids = (list?.tags ?? [])
          .filter((t) => t[0] === 'e')
          .map((t) => t[1])
          .reverse()

        if (ids.length === 0) {
          setEvents([])
          setLoading(false)
          return
        }

        // Scoped to authorQueryRelaySet as of 2026-08-16 — this used to be
        // deliberately unscoped (comment below, kept for context: "a
        // bookmarked note can be anywhere, not just the local relay"), but
        // that's what made this fetch consistently time out for a real
        // user on both desktop and mobile. Read NDK's own relay-selection
        // logic directly (calculateRelaySetsFromFilter): an {ids} filter
        // with no `authors` and no explicit relaySet falls back to
        // querying EVERY url in ndk.explicitRelayUrls (local + the public
        // bootstrap relays + any custom relay a user has added in
        // Settings), and eoseReceived only resolves once ALL of those
        // relays report EOSE (or a slower percentage-based early-exit
        // converges) — a single slow/unreachable custom relay blocks the
        // whole fetch until the timeout fires, every time, for that user.
        // Passing authorQueryRelaySet explicitly bounds this to the same
        // 3 known-fast relays already proven reliable for the sibling
        // list fetch above. Real, documented tradeoff: a note bookmarked
        // that exists *only* on a relay outside this set won't be found —
        // accepted because "usually finds it, in bounded time" beats
        // "blocks on every relay, times out for real users."
        const found = await withTimeout(
          ndk.fetchEvents({ ids }, undefined, authorQueryRelaySet),
          BOOKMARKS_TIMEOUT_MS,
          'Timed out loading your bookmarked notes',
        )
        if (cancelled) return

        const byId = new Map(Array.from(found).map((e) => [e.id, e]))
        setEvents(ids.map((id) => byId.get(id)).filter((e): e is NDKEvent => !!e))
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load bookmarks')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [active, activeUser])

  if (loading) {
    return <FeedSkeleton />
  }

  if (error) {
    return (
      <div className="feed-empty">
        <p className="alert-error">{error}</p>
        <p className="feed-empty-hint">Try switching tabs and back to retry.</p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="feed-empty">
        <p>No bookmarks yet.</p>
        <p className="feed-empty-hint">
          Bookmark a note from its engagement bar and it'll show up here.
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
