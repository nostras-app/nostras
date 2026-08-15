import { useSyncExternalStore } from 'react'
import { ndk, authorQueryRelaySet } from '../lib/ndk'
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
  ndk
    .fetchEvent(
      { kinds: [KIND_BADGE_DEFINITION], authors: [parsed.pubkey], '#d': [parsed.d] },
      undefined,
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
