import NDK, { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { getCustomRelays } from './customRelays'
import { makeRelayConnectionFilter } from './relayFilter'

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

// No default signer here — which of a local key, NIP-46 bunker, or NIP-07
// extension to use is decided by AuthGate.tsx on first load (or restored
// from a previous choice), not assumed at module-load time. Assigning
// ndk.signer later works fine; NDK is built for the signer to be set
// after construction (this is how signer *switching* already works).
export const ndk = new NDK({
  explicitRelayUrls,
  // Blocks connecting to private/local-network relay addresses discovered
  // via outbox aggregation (untrusted third-party data) while still
  // allowing our own explicitly configured local relay through — see
  // relayFilter.ts for why this matters (real user-visible symptom: a
  // discovered ws://127.0.0.1:.../ relay made Chrome flag the whole page
  // "Not Secure" via its Local Network Access protection).
  relayConnectionFilter: makeRelayConnectionFilter(localRelayUrl),
})

// Scoped to the local relay only, and never mutated — used for NIP-50
// search reads, which are only indexed on our own relay (server/search.go),
// not guaranteed to be supported by the public bootstrap relays.
export const localRelaySet = NDKRelaySet.fromRelayUrls([localRelayUrl], ndk)

// Local relay + the public bootstrap relays, explicit and never mutated —
// used for authors-filtered profile/feed queries (useFollowing,
// useFollowCounts, useNoteFeed). Deliberately NOT the same as
// localRelaySet: an earlier fix (2026-08-09) scoped those queries to
// localRelaySet alone to kill a real correctness bug (an unscoped query
// raced NDK's own CONNECTED-only relay fallback and could resolve on a
// stale/partial answer) — but that traded correctness for speed. Real
// user report, same day: a profile that isn't a NOSTRAS user (so has
// nothing on our own relay directly) took many seconds to load, because
// every such view now depended entirely on our relay's own bounded-but-
// still-up-to-~10s server-side outbox fetch (server/outbox.go), with no
// parallel path. Passing this explicit multi-relay set instead restores
// that parallelism *without* reintroducing the original race: passing a
// relaySet explicitly makes NDK actively connect every relay in it via
// pool.useTemporaryRelay() regardless of prior connection status, unlike
// the unscoped case, which only fell back to whatever happened to
// already be CONNECTED at query time. Confirmed by reading NDK's own
// eose logic (NDKSubscription.eoseReceived): once >=2 of the queried
// relays have reported EOSE, it applies a short converging timeout
// rather than waiting on every relay — so a well-known external user
// already indexed on the public relays resolves almost immediately from
// them, while our own relay's slower outbox fetch still runs as a
// correctness backstop for anyone it's the only source for.
export const authorQueryRelaySet = NDKRelaySet.fromRelayUrls(
  [localRelayUrl, ...publicRelayUrls],
  ndk,
)

// A SEPARATE instance from localRelaySet (same starting membership, but a
// distinct Set) — this one backs actual publishing everywhere in the app
// (event.publish(devPublishRelaySet), unchanged at every call site) and is
// deliberately local-only by default for dev safety, but its `.relays` Set
// gets mutated in place by lib/publishTargets.ts when the user opts a note
// into publishing to additional relays too (Settings > Relays). Sharing one
// instance between this and localRelaySet would leak those opt-in targets
// into search reads, which must stay local-only regardless.
export const devPublishRelaySet = NDKRelaySet.fromRelayUrls([localRelayUrl], ndk)
