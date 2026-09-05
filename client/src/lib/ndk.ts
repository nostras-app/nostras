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
  // A `["client", "Nostras"]` tag on every published event — the same
  // convention virtually every other Nostr client already uses (Amethyst,
  // Primal, zap.stream, Yakihonne, ...). NDK applies this automatically to
  // everything signed through this instance; no per-call-site change
  // needed. Prompted directly (2026-09-06) by a real operator question —
  // "how many real NOSTRAS clients are connecting?" — the raw relay
  // connection count on the dashboard mixes in every other client, every
  // relay doing NIP-65 outbox lookups, and relay-monitoring/crawler
  // traffic, so it was never a usable proxy for that. This tag lets a
  // future dashboard metric count distinct pubkeys that have published via
  // the real client — attached only to content the user already chose to
  // make public, so it adds no new privacy exposure. Deliberately not also
  // setting `clientNip89` here: that field wants a real NIP-89 address
  // (`31990:<pubkey>:<d-tag>`) for the *client itself*, which would need
  // wiring to the DVM's own `nostras-client` handler-announcement identity
  // (server/cmd/dvm/main.go) across two otherwise-independent codebases —
  // real, but a separate, smaller follow-up, not required for the
  // counting goal this was actually asked to solve.
  clientName: 'Nostras',
})

// NIP-42: some relays (real example found 2026-08-12 — a DM recipient's
// own declared kind:10050 relay, wss://auth.nostr1.com) require signing
// an auth challenge before they'll accept reads or writes at all — with
// no policy set, NDK just leaves those relays rejecting everything,
// silently. This is exactly why that DM likely never reached its
// recipient: discoverRecipientDmRelays (lib/dm.ts) correctly found and
// targeted their relay, but the publish there had no way to complete the
// auth handshake. Auto-signing needs no user confirmation: proving
// pubkey ownership to a relay isn't a financial action and isn't
// publishing anything publicly, unlike this project's standing invoice-
// payment rule — it's the same background step every other real Nostr
// client performs automatically, and is often what a relay uses
// specifically to *protect* privacy (an auth-gated DM relay is what
// stops any visitor from scanning #p tags to see who's messaging whom).
//
// Deliberately NOT NDKRelayAuthPolicies.signIn({ndk}), despite that
// being NDK's own documented helper for exactly this — verified live,
// with ndk:* debug logging on, that it resolves the auth challenge with
// an NDKEvent, which drives this NDK version's relay-connectivity code
// down a path that never reaches AUTHENTICATED or retries the queued
// publish (confirmed via a real publish attempt hanging to its timeout,
// no error, no "Authentication successful" log — traced into NDK's own
// installed source, not assumed). A policy resolving with plain boolean
// `true` instead drives the *other* internal path, which does complete
// correctly (uses ndk.signer itself) — confirmed by the same debug log
// showing "Authentication successful" and a real subsequent publish
// (kind 1059, matching what NIP-17 DMs actually send) succeeding.
ndk.relayAuthDefaultPolicy = async () => true

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

// A SEPARATE instance from localRelaySet (a distinct Set, never shared) —
// this one backs actual publishing everywhere in the app
// (event.publish(devPublishRelaySet), unchanged at every call site). Its
// `.relays` Set gets mutated in place by lib/publishTargets.ts when the
// user opts a note into publishing to additional relays too (Settings >
// Relays). Sharing one instance between this and localRelaySet would leak
// those opt-in targets into search reads, which must stay local-only
// regardless.
//
// Starting membership is deliberately environment-split (2026-08-10),
// not the same everywhere as it used to be. The name stays
// "devPublishRelaySet" even though it's no longer local-only in
// production — same reasoning as localRelayUrl keeping its name: the
// actual invariant ("this project's own dev-safety / session-scoped
// opt-in convention") is what matters, not the literal string "dev,"
// and renaming would touch every call site for a cosmetic reason.
//
// Real product bug, not just a dev nicety: local-only-by-default was
// built to stop *this project's own* dev/test sessions from ever
// accidentally broadcasting to the real public network — a real concern
// while iterating against a live production deployment. But the exact
// same restriction, unconditionally applied to every real end user in
// production too, meant a genuine new user's first note was invisible
// to the rest of Nostr unless they discovered Settings > Relays and
// manually opted in, every single session (it resets on reload, by
// design, for the dev-safety case). Confirmed as a real, live incident
// (2026-08-10): three real outreach replies published successfully by
// every visible signal, and were invisible to their recipients, because
// none of them ever left our own relay. A build-time split fixes this
// at the root rather than relying on better UI alone to compensate for
// a default that quietly works against the product's own purpose:
// import.meta.env.PROD (set by Vite; true only for the real deployed
// app.nostras.app build, never for local/dev testing, including this
// project's own Claude-driven dev sessions) gets the same
// general-purpose public relays already used elsewhere in this file for
// reads (publicRelayUrls) as real default publish targets, in addition
// to our own relay. Local/dev builds keep the original local-only
// default unchanged — this project's own testing safety net is
// untouched by this change.
export const devPublishRelaySet = NDKRelaySet.fromRelayUrls(
  import.meta.env.PROD ? [localRelayUrl, ...publicRelayUrls] : [localRelayUrl],
  ndk,
)
