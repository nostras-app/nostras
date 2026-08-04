import NDK, { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { getDevSigner } from './signer'
import { getCustomRelays } from './customRelays'

// Bootstrap relay set for local development. ws://localhost:7777 is the
// self-hosted khatru node (server/); the public relays are just so the feed
// isn't empty during early development.
export const localRelayUrl = 'ws://localhost:7777'

export const publicRelayUrls = ['wss://relay.damus.io', 'wss://relay.primal.net']

// User-added relays (Settings > Relays), persisted in localStorage —
// included at startup so a reload reconnects to them without the user
// having to re-add anything.
export const explicitRelayUrls = [localRelayUrl, ...publicRelayUrls, ...getCustomRelays()]

export const ndk = new NDK({
  explicitRelayUrls,
  signer: getDevSigner(),
})

// Scoped to the local relay only. Reused for two purposes: dev-safe
// publishing (public relays above are read-only feed sources here, not
// somewhere dev/test notes should get broadcast to the real network),
// and NIP-50 search reads — search is only indexed on our own relay
// (server/search.go), not guaranteed to be supported by the public
// bootstrap relays, so search queries are deliberately scoped here too.
export const localRelaySet = NDKRelaySet.fromRelayUrls([localRelayUrl], ndk)
export const devPublishRelaySet = localRelaySet
