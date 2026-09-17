import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, authorQueryRelaySet } from '../lib/ndk'
import { useRelayStatus } from './useRelayStatus'
import { KIND_POLL } from '../lib/poll'
import { KIND_FORUM_THREAD } from '../lib/forum'
import { KIND_PODCAST_EPISODE, withTimeout } from '../lib/podcast'
import { KIND_LISTING } from '../lib/listing'
import { KIND_JOB_OFFER } from '../lib/job'

// A page's worth of history, both for the initial subscription's own
// backlog and for each loadOlder() fetch below.
const PAGE_SIZE = 50

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

// Real, live bug reported by a real user (2026-08-15), directly caused by
// the holdNewEvents feature above: neither `events` nor `newEvents` had
// any size cap, so a large Following list (hundreds of people) left open
// for a long session genuinely accumulated tens of thousands of buffered
// notes — a real "16147 new notes" pill, not a display glitch. Clicking
// it called showNew(), which merged the *entire* buffer into `events` in
// one synchronous state update — React then tried to mount 16,000+
// <FeedItem> cards (each with its own avatar fetch, profile lookup,
// engagement bar) in a single commit, which is exactly what froze the
// tab (a real browser "Page Unresponsive" dialog, confirmed live).
// MAX_RENDERED_EVENTS bounds both the rendered list and the pending
// buffer to a fixed rolling window of the most recent notes — nobody
// meaningfully scrolls through thousands of feed items anyway, and this
// keeps every merge (live or on-tap) a bounded, cheap operation
// regardless of how long a tab stays open or how large the follow list
// is.
const MAX_RENDERED_EVENTS = 200

// Subscribes to kind:1 notes, kind:30023 long-form articles, kind:9041
// zap goals, kind:1068 polls, kind:11 forum threads, kind:54 podcast
// episodes, and kind:30402 classified listings — either the global feed
// (authors omitted) or a single author's notes (profile view). Shared
// here so both call sites get the same dedup/sort/eose/event:dup
// handling instead of two copies. FeedItem (Feed.tsx) branches on
// event.kind to render a normal note, an article card, a zap goal card,
// a poll card, a thread card, a podcast episode card, or a listing card.
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
export function useNoteFeed(
  authors?: string[],
  options?: { holdNewEvents?: boolean; excludePubkeys?: string[] },
) {
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
  // Set synchronously inside the pending-buffer updater below. A plain ref
  // is enough — it only needs to be correct by the time the same setState
  // call that set it also triggers the re-render that reads it, not to
  // cause a render on its own.
  const truncatedRef = useRef(false)
  // The mute list (useMuteList) resolves asynchronously and can change at
  // any time (mute/unmute elsewhere in the app) — a ref, updated by its
  // own lightweight effect below, lets the live 'event' handler check it
  // at match-time without needing excludePubkeys in the subscription
  // effect's own dependency array. Deliberately NOT part of that effect:
  // muting someone shouldn't tear down and resubscribe the whole feed,
  // it should just start being excluded going forward. This only stops
  // an event from ever entering `events`/`newEvents` in the first
  // place — it does nothing for something already sitting in state from
  // before the mute existed (e.g. a note that was part of the initial
  // backlog fetched before the mute list had loaded). See excludeSet
  // below for the part that handles that.
  const excludeRef = useRef<Set<string>>(new Set())

  // How many events loadOlder() has explicitly paged in beyond the
  // initial backlog — the live-arrival handler below normally caps
  // `events` at MAX_RENDERED_EVENTS on every new note (PQ-043's
  // freeze-prevention slice), but without this offset that same slice
  // would silently discard history the user just explicitly asked to
  // load the next time any live note arrives. Reset alongside the rest
  // of this feed's state whenever it resets (new author, relay
  // recovery) — not persisted across a genuine resubscribe.
  const pagedInCountRef = useRef(0)

  // Mirrors `events` for loadOlder() below, which needs to read the
  // current oldest-loaded timestamp synchronously without depending on
  // `events` itself (that would redefine the callback, and therefore
  // reset any in-flight caller's closure, on every single event arrival
  // from the live subscription — the same ref-for-synchronous-read
  // pattern excludeRef already uses above, for the same reason).
  const eventsRef = useRef<NDKEvent[]>([])
  useEffect(() => {
    eventsRef.current = events
  }, [events])

  const authorsKey = authors?.join(',') ?? ''
  const excludeKey = options?.excludePubkeys?.join(',') ?? ''

  // Kinds this feed subscribes to and pages through — kind:1 notes,
  // kind:30023 long-form articles, kind:9041 zap goals, kind:1068 polls,
  // kind:11 forum threads, kind:54 podcast episodes, kind:30402
  // classified listings, kind:30406 job offers. Static, but computed
  // once per render rather than module-level since KIND_POLL etc. are
  // plain numbers anyway — kept here (not hoisted to module scope) so
  // both the subscription effect and loadOlder below share the exact
  // same list without a second copy to keep in sync.
  const kinds = useMemo(
    () => [
      1,
      30023,
      KIND_ZAP_GOAL,
      KIND_POLL as NDKKind,
      KIND_FORUM_THREAD,
      KIND_PODCAST_EPISODE,
      KIND_LISTING,
      KIND_JOB_OFFER,
    ],
    [],
  )

  // Real, live user report (2026-09-13): a profile's own-notes feed has
  // no way to see anything past the initial PAGE_SIZE backlog — a note
  // genuinely still stored on the relay (confirmed directly via `nak`)
  // just silently never loads once enough newer activity pushes it past
  // the subscription's own limit, with nothing in the UI indicating
  // there's more history that was never fetched. loadOlder() is a real,
  // explicit pagination action: a one-shot fetchEvents() for events
  // strictly older than whatever's currently loaded, merged in rather
  // than replacing. Deliberately NOT wired into the live subscription's
  // own MAX_RENDERED_EVENTS cap — that cap exists to stop an unbounded
  // *live* arrival flood from freezing the tab in one commit (PQ-043);
  // a user explicitly clicking "load older" a page at a time is a
  // fundamentally safer, self-paced pattern that shouldn't be capped
  // the same way.
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)

  const loadOlder = useCallback(async () => {
    if (loadingOlder) return
    const current = eventsRef.current
    if (current.length === 0) return
    const oldest = current.reduce(
      (min, e) => Math.min(min, e.created_at ?? min),
      current[0].created_at ?? Math.floor(Date.now() / 1000),
    )
    setLoadingOlder(true)
    setLoadOlderError(null)
    const filter = authors
      ? { kinds, authors, until: oldest - 1, limit: PAGE_SIZE }
      : { kinds, until: oldest - 1, limit: PAGE_SIZE }
    try {
      const fetched = await withTimeout(
        ndk.fetchEvents(filter, undefined, authors ? authorQueryRelaySet : undefined),
        8000,
        'Timed out loading older notes',
      )
      const older = Array.from(fetched).filter((e) => !excludeRef.current.has(e.pubkey))
      if (older.length === 0) {
        setHasMore(false)
      } else {
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          const genuinelyNew = older.filter((e) => !seen.has(e.id))
          pagedInCountRef.current += genuinelyNew.length
          return [...prev, ...genuinelyNew].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
        })
      }
    } catch (e) {
      setLoadOlderError(e instanceof Error ? e.message : 'Failed to load older notes')
    } finally {
      setLoadingOlder(false)
    }
    // authorsKey (not authors) is the real dependency, same reasoning as
    // the subscription effect above — a fresh array reference on every
    // render must not redefine this callback. Same already-accepted
    // oxlint warning shape as that effect, not suppressed here either.
  }, [authorsKey, kinds, loadingOlder])

  useEffect(() => {
    excludeRef.current = new Set(options?.excludePubkeys ?? [])
    // excludeKey (not options?.excludePubkeys itself) is the real
    // dependency for the same reason authorsKey is below — a plain array
    // gets a new reference every render.
  }, [excludeKey])

  // Real bug caught during live verification, not shipped: a note from an
  // author who gets muted *after* it already loaded into `events` (e.g.
  // it was part of the initial backlog, fetched before the mute list
  // itself finished loading) stayed visible forever — excludeRef only
  // ever gated new arrivals, never re-filtered what was already there.
  // This derives the actually-rendered lists from the raw stored state on
  // every mute-list change, so muting someone retroactively hides
  // anything of theirs already on screen too, not just future notes.
  // excludeKey, not options?.excludePubkeys itself, is the real dependency
  // here too — same reason as authorsKey/the ref effect above.
  const excludeSet = useMemo(() => new Set(options?.excludePubkeys ?? []), [excludeKey])
  const visibleEvents = useMemo(
    () => (excludeSet.size === 0 ? events : events.filter((e) => !excludeSet.has(e.pubkey))),
    [events, excludeSet],
  )
  const visibleNewEvents = useMemo(
    () => (excludeSet.size === 0 ? newEvents : newEvents.filter((e) => !excludeSet.has(e.pubkey))),
    [newEvents, excludeSet],
  )

  const showNew = useCallback(() => {
    setNewEvents((pending) => {
      if (pending.length === 0) return pending
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id))
        return [...pending.filter((e) => !seen.has(e.id)), ...prev]
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
          .slice(0, MAX_RENDERED_EVENTS)
      })
      truncatedRef.current = false
      return []
    })
  }, [])

  useEffect(() => {
    setHasMore(true)
    setLoadOlderError(null)
    pagedInCountRef.current = 0

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
    truncatedRef.current = false
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
    const sub = ndk.subscribe(
      authors ? { kinds, authors, limit: PAGE_SIZE } : { kinds, limit: PAGE_SIZE },
      authors ? { relaySet: authorQueryRelaySet } : undefined,
    )

    sub.on('event', (event: NDKEvent) => {
      if (stopped) return
      // Checked first, before hold/merge logic — a muted author's note
      // never enters `events` or `newEvents`, so it's excluded from both
      // the rendered feed and the "N new notes" pill count, not just
      // hidden after the fact (which would make the pill's own count
      // dishonest — the exact lesson already learned once for the
      // truncation label above).
      if (excludeRef.current.has(event.pubkey)) return
      if (holdNewEvents && eoseReachedRef.current) {
        setNewEvents((prev) => {
          if (prev.some((existing) => existing.id === event.id)) return prev
          // Capped the same way as the rendered list below — a pending
          // buffer that grows without bound is exactly what turned into
          // a real 16,000+-item freeze the moment it got shown; keeping
          // only the most recent MAX_RENDERED_EVENTS here means the
          // eventual showNew() merge is always cheap, not just usually.
          const next = [event, ...prev]
          if (next.length > MAX_RENDERED_EVENTS) truncatedRef.current = true
          return next.slice(0, MAX_RENDERED_EVENTS)
        })
        return
      }
      setEvents((prev) => {
        if (prev.some((existing) => existing.id === event.id)) return prev
        return [event, ...prev]
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
          .slice(0, MAX_RENDERED_EVENTS + pagedInCountRef.current)
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

  return {
    // Filtered (via visibleEvents/visibleNewEvents above), not the raw
    // events/newEvents state directly — see the excludeSet comment above
    // for why a mute needs to retroactively hide already-loaded notes,
    // not just block new ones.
    events: visibleEvents,
    loading,
    newCount: visibleNewEvents.length,
    // True once the pending buffer has ever hit MAX_RENDERED_EVENTS and
    // had to drop older entries — lets the pill say "200+" instead of
    // implying an exact count it can no longer actually back up.
    newCountTruncated: truncatedRef.current,
    showNew,
    loadOlder,
    loadingOlder,
    loadOlderError,
    hasMore,
  }
}
