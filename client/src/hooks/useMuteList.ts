import { useCallback, useState, useSyncExternalStore } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, authorQueryRelaySet } from '../lib/ndk'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'
import { useActiveUser } from './useActiveUser'

// Matches useFollowing.ts/useBookmark.ts/useNip65RelayList.ts's own
// convention for this exact bug class.
const PUBLISH_TIMEOUT_MS = 8000

type MuteListData = { tags: string[][]; content: string }

// Real bug caught during live verification, not shipped: this used to be a
// plain per-call useState hook, the same shape as useFollowing/useBookmark
// before their own fixes — but unlike those (mostly one real consumer at a
// time), this hook now has two genuinely simultaneous consumers that both
// need the SAME live list: NoteMenu's per-note mute button (deep inside
// FeedItem) and Feed's own feed-filtering call, both mounted at once (this
// app keeps every view mounted). With independent per-instance state,
// muting someone via NoteMenu updated only NoteMenu's own local copy —
// Feed's separate instance never learned about it and kept showing the
// muted author's notes until a full reload forced a fresh fetch. Fixed by
// moving the list itself into a module-level cache (same
// useSyncExternalStore pattern as useProfile.ts's cache), so every
// consumer reads and reacts to one shared, live-updated source of truth.
const cache = new Map<string, MuteListData>()
const inFlight = new Set<string>()
const listeners = new Set<() => void>()
// A stable, referentially-unchanging fallback — `data?.tags ?? []` would
// otherwise produce a brand-new array literal every render whenever data
// is null (no active user yet, or still loading), which oxlint correctly
// flags as breaking toggle's useCallback memoization below.
const EMPTY_TAGS: string[][] = []

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function ensureFetched(pubkey: string) {
  if (cache.has(pubkey) || inFlight.has(pubkey)) return
  inFlight.add(pubkey)
  // fetchLatestReplaceableEvent, not plain ndk.fetchEvent() — even
  // authorQueryRelaySet-scoped, fetchEvent() hardcodes closeOnEose:true
  // and can converge on a stale relay's copy of this replaceable
  // kind:10000 mute list before a slower relay's fresher one arrives
  // (2026-08-17, see CLAUDE.md's dated entry). A stale copy here is a
  // real toggle() data-loss risk, not just cosmetic — same class of
  // risk useFollowing.ts's own loading-guard exists to prevent.
  fetchLatestReplaceableEvent({ kinds: [10000], authors: [pubkey] }, authorQueryRelaySet)
    .then((event) => {
      cache.set(pubkey, { tags: event?.tags ?? [], content: event?.content ?? '' })
      inFlight.delete(pubkey)
      notify()
    })
    .catch(() => {
      // Never leave inFlight permanently set on a rejection — same
      // reasoning as useProfile.ts's own fetch failure handling.
      inFlight.delete(pubkey)
    })
}

// NIP-51 kind:10000 mute list — a single replaceable event per user,
// listing muted pubkeys as `p` tags. Same fetch-then-republish safety
// shape this project settled on after fixing the identical bug three
// times elsewhere (useFollowing/useBookmark/useNip65RelayList): a
// loading guard against toggling before the current list is known (kind
// :10000 is replaceable, so muting before the fetch resolves would
// silently overwrite the user's real list with just the one new entry),
// an explicit publish timeout, and a real surfaced error instead of a
// swallowed rejection.
export function useMuteList() {
  const activeUser = useActiveUser()
  const pubkey = activeUser?.pubkey ?? null
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const data = useSyncExternalStore(subscribe, () => {
    if (!pubkey) return null
    ensureFetched(pubkey)
    return cache.get(pubkey) ?? null
  })

  const loading = !!pubkey && !data
  const tags = data?.tags ?? EMPTY_TAGS
  const content = data?.content ?? ''
  const pubkeys = tags.filter((t) => t[0] === 'p' && !!t[1]).map((t) => t[1])
  const isMuted = useCallback((target: string) => pubkeys.includes(target), [pubkeys])

  const toggle = useCallback(
    async (target: string): Promise<boolean> => {
      // Refuse to run before the initial fetch of the CURRENT list
      // resolves — see the fix note above for why this matters.
      if (!pubkey || busy || loading) return false
      setBusy(target)
      setError(null)
      try {
        const currentlyMuted = pubkeys.includes(target)
        const nextTags = currentlyMuted
          ? tags.filter((t) => !(t[0] === 'p' && t[1] === target))
          : [...tags, ['p', target]]
        const event = new NDKEvent(ndk, { kind: 10000, tags: nextTags, content })
        await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
        // Update the shared cache directly, not local state — this is
        // what makes the fix above actually work: every other mounted
        // useMuteList() consumer (e.g. Feed's feed-filtering call) picks
        // up this exact change via the same notify() call.
        cache.set(pubkey, { tags: nextTags, content })
        notify()
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update mute list')
        return false
      } finally {
        setBusy(null)
      }
    },
    [pubkey, pubkeys, tags, content, busy, loading],
  )

  return { pubkeys, isMuted, toggle, loading, busy, error }
}
