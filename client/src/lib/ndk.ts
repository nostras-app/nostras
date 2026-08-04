import NDK, { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { getDevSigner } from './signer'
import { getCustomRelays } from './customRelays'

// The self-hosted khatru node (server/). Defaults to localhost for local
// dev; the deployed build sets VITE_RELAY_URL (e.g. wss://nostras.app) at
// build time via Fly/CI env vars — see server/fly.toml for the deploy
// shape. Kept as "local" in naming/comments throughout this codebase since
// that's still accurate for local dev, and "our own relay" is the actual
// invariant that matters (dev-safe publishing, NIP-50 search scope) — not
// literally running on localhost.
export const localRelayUrl = import.meta.env.VITE_RELAY_URL || 'ws://localhost:7777'

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
