// A hand-picked list of well-known, generally-reliable public relays for
// the NoteMenu "Rebroadcast to relays…" picker (2026-08-07) — prompted by
// the user finding Yakihonne's own "republish" feature offers a much
// longer relay checklist than NOSTRAS's prior single-button rebroadcast
// (which only ever sent to whatever was in this session's publish-target
// toggles). This list is intentionally separate from that mechanism: it's
// for a one-off, explicitly-chosen broadcast of a specific note/article,
// not the standing local-only-by-default publish scope every other
// publish action in this app still respects.
//
// Deliberately a fixed, hardcoded, trusted list (not fetched or
// user-submitted) — Settings > Relays already covers adding arbitrary
// custom relays if someone wants a longer or different list than this.
export const CURATED_RELAYS: string[] = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social',
  'wss://purplepag.es',
  'wss://eden.nostr.land',
  'wss://relay.nostr.bg',
  'wss://nostr21.com',
  'wss://relay.current.fyi',
  'wss://offchain.pub',
  'wss://nostr.mom',
  'wss://relayable.org',
  'wss://nostr.oxtr.dev',
]
