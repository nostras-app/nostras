import { useCallback, useEffect, useRef, useState } from 'react'
import type { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, authorQueryRelaySet } from '../lib/ndk'
import { useRelayStatus } from './useRelayStatus'
import { KIND_POLL } from '../lib/poll'
import { KIND_FORUM_THREAD } from '../lib/forum'
import { KIND_PODCAST_EPISODE } from '../lib/podcast'

// Not in NDK's own kind catalog — same gap already hit for several
// other project-specific kinds this session (NIP-29 delete kinds,
// paid-article-unlock, NIP-38/39, NIP-22 comments).
const KIND_ZAP_GOAL = 9041 as NDKKind

// Real, live bug caught in production, not hypothetical: `loading` only
// ever cleared on the subscription's own `eose` event — if a single
// relay in an author-scoped query (authorQueryRelaySet: local + two
// public bootstrap relays) never reports EOSE, this skeleton hangs
// forever, no matter how many events already arrived. This is the same
// missing-timeout/no-fallback class already fixed for blossom.ts's
// upload and zap.ts's invoice fetch this session, just on a subscription
// instead of a promise. A generous ceiling (this covers every profile/
// feed view in the app, not a single one-off action) that flips loading
// off regardless — real events keep streaming in via the 'event'
// listener either way, this only affects when the skeleton gives up.
const EOSE_FALLBACK_MS = 12000

// Subscribes to kind:1 notes, kind:30023 long-form articles, kind:9041
// zap goals, kind:1068 polls, kind:11 forum threads, and kind:54 podcast
// episodes — either the global feed (authors omitted) or a single
// author's notes (profile view). Shared here so both call sites get the
// same dedup/sort/eose/event:dup handling instead of two copies.
// FeedItem (Feed.tsx) branches on event.kind to render a normal note, an
// article card, a zap goal card, a poll card, a thread card, or a
// podcast episode card.
//
// Real, live UX report (2026-08-14): on a busy feed, a note arriving
// live got prepended straight into `events`, reflowing everything below
// it — on mobile this reliably knocked a note the user was mid-action on
// (reading, liking, bookmarking, zapping) out from under their thumb,
// sometimes several times a minute on the Global feed. Matches the exact
// "stop auto-inserting, batch behind a tappable pill" pattern every
// other major feed-based client converged on for the same reason.
// `holdNewEvents` opts a caller into that behavior: events arriving
// *after* the initial backlog (post-EOSE) are buffered in `newEvents`
// instead of merged, surfaced only as a count, and only actually spliced
// into `events` when the caller calls `showNew()` — an explicit,
// user-initiated action, not something arriving from the network.
// Defaults to false (the original, always-merge behavior) so
// ProfileView's own, much lower-velocity feed is unaffected — this
// wasn't reported there, and changing its contract for free wasn't the
// ask.
export function useNoteFeed(authors?: string[], options?: { holdNewEvents?: boolean }) {
  const holdNewEvents = options?.holdNewEvents ?? false
  const [events, setEvents] = useState<NDKEvent[]>([])
  const [newEvents, setNewEvents] = useState<NDKEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [, forceUpdate] = useState(0)
  const { generation } = useRelayStatus()
  // A ref, not state: read synchronously inside the 'event' listener,
  // which closes over whatever was true at subscribe time otherwise —
  // state wouldn't reliably reflect "EOSE already fired" by the time a
  // fast-arriving event's handler runs.
  const eoseReachedRef = useRef(false)

  const authorsKey = authors?.join(',') ?? ''

  const showNew = useCallback(() => {
    setNewEvents((pending) => {
      if (pending.length === 0) return pending
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id))
        return [...pending.filter((e) => !seen.has(e.id)), ...prev].sort(
          (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
        )
      })
      return []
    })
  }, [])

  useEffect(() => {
    if (authors && authors.length === 0) {
      setEvents([])
      setNewEvents([])
      setLoading(false)
      return
    }

    setEvents([])
    setNewEvents([])
    setLoading(true)
    eoseReachedRef.current = false
    // Real, live bug caught during verification, not shipped: `sub.stop()`
    // in the cleanup below doesn't synchronously guarantee no more
    // 'event' callbacks fire from an already-torn-down subscription (NDK
    // may still deliver something already in flight). Without this guard,
    // switching feeds quickly enough (e.g. Global -> an empty Following)
    // could have a stray late event from the *old* subscription land in
    // `newEvents` for the *new* one, via the shared functional setter —
    // reproduced live as a real "45 new notes" pill sitting over an
    // otherwise-empty Following tab. Checked at the top of every listener
    // below, flipped only in the cleanup function.
    let stopped = false

    // Author-scoped subscriptions (profile view, Following feed) are
    // scoped to authorQueryRelaySet rather than left to NDK's own
    // client-side outbox resolution — see useFollowing.ts and
    // authorQueryRelaySet's own comment in lib/ndk.ts for the full
    // rationale (a first fix scoped this to localRelaySet alone, which
    // was correct but slow for anyone not already on our own relay).
    // The global feed (authors omitted) is unaffected: with no `authors`
    // in the filter, NDK already queries the full explicit relay list
    // unconditionally, not gated on which relays happen to be CONNECTED
    // yet, so it was never subject to this race.
    const kinds = [1, 30023, KIND_ZAP_GOAL, KIND_POLL as NDKKind, KIND_FORUM_THREAD, KIND_PODCAST_EPISODE]
    const sub = ndk.subscribe(
      authors ? { kinds, authors, limit: 50 } : { kinds, limit: 50 },
      authors ? { relaySet: authorQueryRelaySet } : undefined,
    )

    sub.on('event', (event: NDKEvent) => {
      if (stopped) return
      if (holdNewEvents && eoseReachedRef.current) {
        setNewEvents((prev) =>
          prev.some((existing) => existing.id === event.id) ? prev : [event, ...prev],
        )
        return
      }
      setEvents((prev) => {
        if (prev.some((existing) => existing.id === event.id)) return prev
        return [event, ...prev].sort(
          (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
        )
      })
    })

    // eose = relays have sent everything they currently have; after this,
    // an empty list means "genuinely no notes", not "still loading" — and
    // (when holdNewEvents is on) the point after which further arrivals
    // get held back instead of merged straight in.
    sub.on('eose', () => {
      if (stopped) return
      eoseReachedRef.current = true
      setLoading(false)
    })

    // event:dup fires when a relay we're already subscribed to confirms an
    // event we already have — it's how event.onRelays grows over time.
    // Nothing about `events` itself changes, so force a re-render to pick
    // up the new count on the "seen on N relays" indicator.
    sub.on('event:dup', () => {
      if (stopped) return
      forceUpdate((n) => n + 1)
    })

    const eoseFallback = setTimeout(() => {
      if (stopped) return
      eoseReachedRef.current = true
      setLoading(false)
    }, EOSE_FALLBACK_MS)

    return () => {
      stopped = true
      clearTimeout(eoseFallback)
      sub.stop()
    }
    // authorsKey (not authors itself) is the real dependency: a plain array
    // prop gets a new reference every render, which would resubscribe on
    // every render even when the actual author list hasn't changed.
    // generation bumps only when the local relay recovers from a real
    // disconnect — see lib/relayStatus.ts — forcing a fresh REQ instead of
    // leaving a stale subscription that NDK never automatically resends.
  }, [authorsKey, generation, holdNewEvents])

  return { events, loading, newCount: newEvents.length, showNew }
}
