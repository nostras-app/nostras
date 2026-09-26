import { useCallback, useState, useSyncExternalStore } from 'react'
import { NDKEvent, NDKKind, type NDKFilter } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, authorQueryRelaySet } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'

// NIP-51 kind:30000 "Follow sets" — named, user-curated lists of people
// (e.g. "VIP", "Nostr devs"), separate from the kind:3 contact list so
// adding someone to a list never changes your public follow list or the
// follower counts other clients show. Addressable: each list is its own
// event keyed by (kind, pubkey, d tag), so a user can have any number of
// lists and two users' lists can never collide. The `d` tag is a random
// id generated once and never changed — it IS the list's identity — while
// the human-readable name lives in the `title` tag, so renaming a list is
// just republishing with a new title. Lists created by other clients
// (Coracle, noStrudel, Amethyst…) show up here too, and ours show up
// there — this is plain NIP-51, nothing NOSTRAS-specific.
//
// Public by explicit user choice (2026-09-23), same convention as
// Following/Bookmarks/Mute: plain `p` tags. Any private (encrypted)
// items another client put in `content` are preserved untouched on
// republish, never read or dropped.

const PUBLISH_TIMEOUT_MS = 8000
const FETCH_WINDOW_MS = 5000

// Older NIP-51 drafts used kind:30000 with these fixed d tags for what
// are now dedicated replaceable kinds (mute 10000, pins 10001, bookmarks
// 10003…). They are not user-named people lists, so don't surface them as
// feed tabs.
const LEGACY_D_TAGS = new Set(['mute', 'pin', 'bookmark', 'communities'])

export type FollowSet = {
  d: string
  title: string
  pubkeys: string[]
  tags: string[][]
  content: string
  createdAt: number
}

type State = { sets: FollowSet[] } // sorted by title

const cache = new Map<string, State>()
const inFlight = new Set<string>()
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function toFollowSet(event: NDKEvent): FollowSet | null {
  const d = event.tags.find((t) => t[0] === 'd')?.[1]
  if (d === undefined || LEGACY_D_TAGS.has(d)) return null
  const title =
    event.tags.find((t) => t[0] === 'title')?.[1]?.trim() ||
    event.tags.find((t) => t[0] === 'name')?.[1]?.trim() ||
    d ||
    'Untitled list'
  return {
    d,
    title,
    pubkeys: Array.from(new Set(event.tags.filter((t) => t[0] === 'p' && !!t[1]).map((t) => t[1]))),
    tags: event.tags,
    content: event.content,
    createdAt: event.created_at ?? 0,
  }
}

function sortSets(sets: FollowSet[]): FollowSet[] {
  return [...sets].sort((a, b) => a.title.localeCompare(b.title))
}

// Same reasoning as fetchLatestReplaceableEvent (lib/fetchLatestReplaceable.ts):
// never trust ndk.fetchEvents()'s early EOSE convergence for replaceable
// data — wait the full window and keep the newest copy seen. The only
// difference is there can be many lists, so "newest" is tracked per d tag.
//
// Deletion requests (kind:5 with an `a` tag, as deleteSet() publishes) are
// fetched in the same subscription: our own relay honors them, but a public
// relay that doesn't would otherwise resurrect a deleted list on reload. A
// list is hidden only if a deletion for its address is at least as new as
// the list itself — recreating a list later (new event, newer created_at)
// isn't hidden by an old deletion.
function fetchAllFollowSets(pubkey: string): Promise<FollowSet[]> {
  return new Promise((resolve) => {
    const newest = new Map<string, NDKEvent>()
    const deletedAt = new Map<string, number>()
    const filters: NDKFilter[] = [
      { kinds: [NDKKind.FollowSet], authors: [pubkey] },
      { kinds: [NDKKind.EventDeletion], authors: [pubkey], '#k': [String(NDKKind.FollowSet)] },
    ]
    const sub = ndk.subscribe(filters, { relaySet: authorQueryRelaySet, closeOnEose: false })
    sub.on('event', (event: NDKEvent) => {
      if (event.kind === NDKKind.EventDeletion) {
        const prefix = `${NDKKind.FollowSet}:${pubkey}:`
        for (const t of event.tags) {
          if (t[0] !== 'a' || !t[1]?.startsWith(prefix)) continue
          const d = t[1].slice(prefix.length)
          deletedAt.set(d, Math.max(deletedAt.get(d) ?? 0, event.created_at ?? 0))
        }
        return
      }
      const d = event.tags.find((t) => t[0] === 'd')?.[1]
      if (d === undefined) return
      const prev = newest.get(d)
      if (!prev || (event.created_at ?? 0) > (prev.created_at ?? 0)) newest.set(d, event)
    })
    setTimeout(() => {
      sub.stop()
      resolve(
        Array.from(newest.values())
          .map(toFollowSet)
          .filter((s): s is FollowSet => s !== null)
          .filter((s) => (deletedAt.get(s.d) ?? -1) < s.createdAt),
      )
    }, FETCH_WINDOW_MS)
  })
}

function ensureFetched(pubkey: string) {
  if (cache.has(pubkey) || inFlight.has(pubkey)) return
  inFlight.add(pubkey)
  fetchAllFollowSets(pubkey)
    .then((sets) => {
      cache.set(pubkey, { sets: sortSets(sets) })
      notify()
    })
    .finally(() => inFlight.delete(pubkey))
}

function replaceSet(pubkey: string, next: FollowSet) {
  const current = cache.get(pubkey)?.sets ?? []
  cache.set(pubkey, { sets: sortSets([...current.filter((s) => s.d !== next.d), next]) })
  notify()
}

async function publishSet(tags: string[][], content: string): Promise<NDKEvent> {
  const event = new NDKEvent(ndk, { kind: NDKKind.FollowSet, tags, content })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
  return event
}

const EMPTY: FollowSet[] = []

// Shared module-level cache (useSyncExternalStore), not per-call state —
// the profile's list picker, the feed tabs and Settings > Lists are all
// mounted at once (every view stays mounted), and they must see the same
// live lists. Same fix useMuteList.ts needed after a real stale-state bug.
export function useFollowSets() {
  const activeUser = useActiveUser()
  const pubkey = activeUser?.pubkey ?? null
  // Key is the list's d tag (or 'new' while creating).
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const state = useSyncExternalStore(subscribe, () => {
    if (!pubkey) return null
    ensureFetched(pubkey)
    return cache.get(pubkey) ?? null
  })

  const sets = state?.sets ?? EMPTY
  const loading = !!pubkey && !state

  const run = useCallback(
    async (key: string, fallbackMessage: string, fn: () => Promise<void>): Promise<boolean> => {
      // Refuse to mutate before the current lists are known — each list is
      // replaceable, so publishing from an empty/partial view would
      // overwrite the real one.
      if (!pubkey || loading || busy) return false
      setBusy(key)
      setError(null)
      try {
        await fn()
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : fallbackMessage)
        return false
      } finally {
        setBusy(null)
      }
    },
    [pubkey, loading, busy],
  )

  const createSet = useCallback(
    (title: string, initialPubkeys: string[] = []) =>
      run('new', 'Failed to create list', async () => {
        const name = title.trim()
        if (!name) throw new Error('Give the list a name')
        const d = crypto.randomUUID()
        const tags = [['d', d], ['title', name], ...initialPubkeys.map((p) => ['p', p])]
        const event = await publishSet(tags, '')
        const set = toFollowSet(event)
        if (set && pubkey) replaceSet(pubkey, set)
      }),
    [run, pubkey],
  )

  const toggleMember = useCallback(
    (d: string, target: string) =>
      run(d, 'Failed to update list', async () => {
        const set = sets.find((s) => s.d === d)
        if (!set) throw new Error('List not found')
        const has = set.pubkeys.includes(target)
        const tags = has
          ? set.tags.filter((t) => !(t[0] === 'p' && t[1] === target))
          : [...set.tags, ['p', target]]
        const event = await publishSet(tags, set.content)
        const next = toFollowSet(event)
        if (next && pubkey) replaceSet(pubkey, next)
      }),
    [run, sets, pubkey],
  )

  // Idempotent add (never removes) — used by the "add people" box inside
  // Settings > Lists, where a pasted npub that's already on the list
  // should be a no-op rather than silently toggling them back off.
  const addMember = useCallback(
    (d: string, target: string) =>
      run(d, 'Failed to update list', async () => {
        const set = sets.find((s) => s.d === d)
        if (!set) throw new Error('List not found')
        if (set.pubkeys.includes(target)) throw new Error('Already on this list')
        const event = await publishSet([...set.tags, ['p', target]], set.content)
        const next = toFollowSet(event)
        if (next && pubkey) replaceSet(pubkey, next)
      }),
    [run, sets, pubkey],
  )

  const renameSet = useCallback(
    (d: string, title: string) =>
      run(d, 'Failed to rename list', async () => {
        const name = title.trim()
        if (!name) throw new Error('List name can’t be empty')
        const set = sets.find((s) => s.d === d)
        if (!set) throw new Error('List not found')
        const hasTitle = set.tags.some((t) => t[0] === 'title')
        const tags = hasTitle
          ? set.tags.map((t) => (t[0] === 'title' ? ['title', name] : t))
          : [...set.tags, ['title', name]]
        const event = await publishSet(tags, set.content)
        const next = toFollowSet(event)
        if (next && pubkey) replaceSet(pubkey, next)
      }),
    [run, sets, pubkey],
  )

  // NIP-09 deletion request by address (`a` tag) — our relay honors it
  // (khatru's deleting.go handles `a`); other relays may or may not.
  const deleteSet = useCallback(
    (d: string) =>
      run(d, 'Failed to delete list', async () => {
        if (!pubkey) return
        const event = new NDKEvent(ndk, {
          kind: NDKKind.EventDeletion,
          tags: [
            ['a', `${NDKKind.FollowSet}:${pubkey}:${d}`],
            ['k', String(NDKKind.FollowSet)],
          ],
          content: '',
        })
        await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
        const current = cache.get(pubkey)?.sets ?? []
        cache.set(pubkey, { sets: current.filter((s) => s.d !== d) })
        notify()
      }),
    [run, pubkey],
  )

  const listsContaining = useCallback(
    (target: string) => sets.filter((s) => s.pubkeys.includes(target)),
    [sets],
  )

  return {
    sets,
    loading,
    busy,
    error,
    createSet,
    toggleMember,
    addMember,
    renameSet,
    deleteSet,
    listsContaining,
  }
}

// Read-only view of ANY user's follow sets (e.g. the lists shown on someone
// else's profile). Shares the same module-level cache as useFollowSets, so
// viewing your own profile doesn't refetch.
export function useFollowSetsOf(pubkey: string | undefined) {
  const state = useSyncExternalStore(subscribe, () => {
    if (!pubkey) return null
    ensureFetched(pubkey)
    return cache.get(pubkey) ?? null
  })
  return { sets: state?.sets ?? EMPTY, loading: !!pubkey && !state }
}
