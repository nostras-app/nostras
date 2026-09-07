import { useSyncExternalStore } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { subscribeRelayStatus, getRelayGeneration } from '../lib/relayStatus'

// Same module-level-cache pattern as useProfile.ts — a reply's parent note
// is frequently referenced by more than one card on the same page (several
// replies to the same root), so caching avoids redundant fetches. Full
// relay pool, not local-only: the parent could be any public note, not
// necessarily one that ever touched our local relay.
const cache = new Map<string, NDKEvent | null>()
const inFlight = new Set<string>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

// Real, reported bug (2026-09-07): a reply stuck showing "Replying to a
// note…" indefinitely, even for a note that genuinely exists and that
// another client (Ditto) resolved and named correctly. Same root cause
// already found and fixed in useProfile.ts a day earlier: a fetch that
// resolves null (the note wasn't found by whichever relays answered
// within this attempt) gets cached permanently with no retry, unlike
// every long-lived subscription hook in this app, which resubscribes on
// a genuine relayStatus.ts relay-recovery signal. This hook was never
// covered by that earlier audit since it's a structurally different
// fetch (a single note by id, not an author's replaceable event) — same
// fix applies directly: clear only the failed (null) entries on a real
// generation bump, so a note that lost the race once gets a genuine
// retry instead of staying stuck for the rest of the session.
let lastReferencedNoteGeneration = getRelayGeneration()
subscribeRelayStatus(() => {
  const gen = getRelayGeneration()
  if (gen === lastReferencedNoteGeneration) return
  lastReferencedNoteGeneration = gen
  let hadFailure = false
  for (const [id, event] of cache) {
    if (event === null) {
      cache.delete(id)
      hadFailure = true
    }
  }
  if (hadFailure) notify()
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function ensureFetched(id: string) {
  if (cache.has(id) || inFlight.has(id)) return
  inFlight.add(id)
  ndk.fetchEvent(id).then((event) => {
    cache.set(id, event)
    inFlight.delete(id)
    notify()
  })
}

// Returns null both while loading and if the note genuinely can't be found
// — same ambiguity useProfile already accepts for the same reason (no
// separate "not found" state needed for a lightweight context line).
export function useReferencedNote(id: string | undefined): NDKEvent | null {
  return useSyncExternalStore(subscribe, () => {
    if (!id) return null
    ensureFetched(id)
    return cache.get(id) ?? null
  })
}
