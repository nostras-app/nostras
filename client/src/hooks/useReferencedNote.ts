import { useSyncExternalStore } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

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
