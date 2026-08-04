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

// Scoped to the local relay only, and never mutated — used for NIP-50
// search reads, which are only indexed on our own relay (server/search.go),
// not guaranteed to be supported by the public bootstrap relays.
export const localRelaySet = NDKRelaySet.fromRelayUrls([localRelayUrl], ndk)

// A SEPARATE instance from localRelaySet (same starting membership, but a
// distinct Set) — this one backs actual publishing everywhere in the app
// (event.publish(devPublishRelaySet), unchanged at every call site) and is
// deliberately local-only by default for dev safety, but its `.relays` Set
// gets mutated in place by lib/publishTargets.ts when the user opts a note
// into publishing to additional relays too (Settings > Relays). Sharing one
// instance between this and localRelaySet would leak those opt-in targets
// into search reads, which must stay local-only regardless.
export const devPublishRelaySet = NDKRelaySet.fromRelayUrls([localRelayUrl], ndk)
