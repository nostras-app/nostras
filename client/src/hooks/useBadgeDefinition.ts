import { useSyncExternalStore } from 'react'
import { authorQueryRelaySet } from '../lib/ndk'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'
import { subscribeRelayStatus, getRelayGeneration } from '../lib/relayStatus'
import {
  KIND_BADGE_DEFINITION,
  parseBadgeAddress,
  parseBadgeDefinition,
  type BadgeDefinition,
} from '../lib/badges'

// Module-level cache shared across every component, same
// useSyncExternalStore pattern as useProfile.ts — a given badge address
// is realistically looked up from several places at once (an award
// list, a profile's badge row, another recipient's own award list), and
// this keeps it to one fetch per address per session regardless of how
// many components render it.
const cache = new Map<string, BadgeDefinition | null>()
const inFlight = new Set<string>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

// Same fix as useProfile.ts/useReferencedNote.ts (2026-09-06/07): a fetch
// that resolves null was cached permanently with no retry, unlike every
// long-lived subscription hook in this app. Clear only the failed (null)
// entries on a genuine relayStatus.ts relay-recovery signal.
let lastBadgeGeneration = getRelayGeneration()
subscribeRelayStatus(() => {
  const gen = getRelayGeneration()
  if (gen === lastBadgeGeneration) return
  lastBadgeGeneration = gen
  let hadFailure = false
  for (const [address, def] of cache) {
    if (def === null) {
      cache.delete(address)
      hadFailure = true
    }
  }
  if (hadFailure) notify()
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function ensureFetched(address: string) {
  if (cache.has(address) || inFlight.has(address)) return
  const parsed = parseBadgeAddress(address)
  if (!parsed) {
    cache.set(address, null)
    return
  }
  inFlight.add(address)
  // fetchLatestReplaceableEvent, not plain ndk.fetchEvent() — even
  // authorQueryRelaySet-scoped, fetchEvent() hardcodes closeOnEose:true
  // and can converge on a stale relay's copy of this addressable
  // kind:30009 definition before a slower relay's fresher one arrives
  // (2026-08-17, see CLAUDE.md's dated entry).
  fetchLatestReplaceableEvent(
    { kinds: [KIND_BADGE_DEFINITION], authors: [parsed.pubkey], '#d': [parsed.d] },
    authorQueryRelaySet,
  )
    .then((event) => {
      cache.set(address, event ? parseBadgeDefinition(event) : null)
      inFlight.delete(address)
      notify()
    })
    .catch(() => {
      inFlight.delete(address)
    })
}

// Read-only lookup of a badge's own definition (name/description/image)
// given its `30009:<pubkey>:<d>` address — used wherever a badge needs
// to actually be rendered, not just referenced by address.
export function useBadgeDefinition(address: string | undefined): BadgeDefinition | null {
  return useSyncExternalStore(subscribe, () => {
    if (!address) return null
    ensureFetched(address)
    return cache.get(address) ?? null
  })
}
