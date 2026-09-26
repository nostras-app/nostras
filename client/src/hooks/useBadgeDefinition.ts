import { useSyncExternalStore } from 'react'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { ndk, authorQueryRelaySet, localRelayUrl } from '../lib/ndk'
import { makeRelayConnectionFilter } from '../lib/relayFilter'
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
  fetchBadgeDefinitionEvent(parsed.pubkey, parsed.d)
    .then((event) => {
      cache.set(address, event ? parseBadgeDefinition(event) : null)
      inFlight.delete(address)
      notify()
    })
    .catch(() => {
      inFlight.delete(address)
    })
}

const isAllowedRelayUrl = makeRelayConnectionFilter(localRelayUrl)
const MAX_ISSUER_RELAYS = 6

// Real gap (2026-09-26): a real badge ("Brasil", issued from Amethyst)
// had its kind:30009 definition ONLY on the issuer's own relays
// (nexus.libernet.app, relay.mitosystem.net, …), none of which are in
// authorQueryRelaySet — so the accepted badge couldn't render for anyone
// whose session didn't happen to have it. Badge definitions live wherever
// the issuer publishes, so fall back to the issuer's NIP-65 write relays
// (outbox model), same approach as lib/dm.ts's recipient-relay discovery.
// Untrusted third-party URLs → filtered through the same private/local
// address guard before NDKRelaySet.fromRelayUrls (which bypasses the
// pool-level filter), and capped so a huge relay list can't fan out.
async function fetchBadgeDefinitionEvent(issuer: string, d: string) {
  const filter = { kinds: [KIND_BADGE_DEFINITION], authors: [issuer], '#d': [d] }
  // fetchLatestReplaceableEvent, not ndk.fetchEvent() — stale-relay
  // EOSE-convergence race (2026-08-17, see CLAUDE.md).
  const found = await fetchLatestReplaceableEvent(filter, authorQueryRelaySet)
  if (found) return found
  const relayList = await fetchLatestReplaceableEvent({ kinds: [10002], authors: [issuer] }, authorQueryRelaySet)
  const writeRelays = (relayList?.tags ?? [])
    .filter((t) => t[0] === 'r' && !!t[1] && t[2] !== 'read')
    .map((t) => t[1])
    .filter(isAllowedRelayUrl)
    .slice(0, MAX_ISSUER_RELAYS)
  if (writeRelays.length === 0) return null
  return fetchLatestReplaceableEvent(filter, NDKRelaySet.fromRelayUrls(writeRelays, ndk))
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
