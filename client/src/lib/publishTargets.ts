import { normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, localRelayUrl, publicRelayUrls } from './ndk'

const normalizedLocalRelayUrl = normalizeRelayUrl(localRelayUrl)

// Session-only (in-memory, never persisted) opt-in extra publish targets —
// always resets to this same starting point on reload, deliberately, so a
// forgotten *manually-added* selection from a past session can never
// silently broadcast dev/test notes to the public network. See CLAUDE.md's
// publish-safety note.
//
// Seeded to match devPublishRelaySet's own real starting membership
// (lib/ndk.ts) rather than always starting empty — production builds
// construct devPublishRelaySet with the public relays already included,
// and this Set exists purely to drive this UI's toggle state
// (isPublishTarget/togglePublishTarget below), so it needs to agree with
// reality from the very first render. Without this, Settings > Relays
// would show the production-default public relays as "off" (and
// re-toggling one back "on" after removing it would try to add a relay
// that's already there) even though they're genuinely already active
// publish targets underneath.
let selected: Set<string> = import.meta.env.PROD
  ? new Set(publicRelayUrls.map(normalizeRelayUrl))
  : new Set()
const listeners = new Set<() => void>()

function setSelected(next: Set<string>) {
  selected = next
  for (const listener of listeners) listener()
}

export function isPublishTarget(url: string): boolean {
  return url === normalizedLocalRelayUrl || selected.has(url)
}

// The local relay is always a publish target and isn't toggleable here.
export function togglePublishTarget(url: string) {
  if (url === normalizedLocalRelayUrl) return

  const next = new Set(selected)
  if (next.has(url)) {
    next.delete(url)
    for (const relay of devPublishRelaySet.relays) {
      if (relay.url === url) {
        devPublishRelaySet.relays.delete(relay)
        break
      }
    }
  } else {
    next.add(url)
    // Ensures the relay is connected (or connecting) before we rely on it
    // for publishing, same as the custom-relay add flow.
    const relay = ndk.pool.getRelay(url, true)
    devPublishRelaySet.relays.add(relay)
  }
  setSelected(next)
}

export function subscribePublishTargets(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPublishTargetsSnapshot(): Set<string> {
  return selected
}
