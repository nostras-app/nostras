import { localRelayUrl } from './ndk'

// The relay's HTTP heartbeat endpoint (server/heartbeat.go) lives at the
// same host as the WebSocket relay — ws(s):// -> http(s):// — same
// convention already established in pushNotifications.ts.
const heartbeatUrl = `${localRelayUrl.replace(/^ws/, 'http').replace(/\/$/, '')}/client-heartbeat`

// Answers a real operator question (2026-09-06): the dashboard's raw
// connection count mixes in every other Nostr client, every relay doing
// NIP-65 outbox lookups against this one, and relay-monitoring/crawler
// traffic — none of that is "how many real NOSTRAS clients are out
// there." This sends a single, empty, fire-and-forget POST once per app
// load so the server can count real client loads separately from that
// noise.
//
// Deliberately sends NO payload of any kind — not a random id, not a
// session token, nothing. A version of this was considered that had the
// client generate a fresh crypto.randomUUID() per load and send that
// along, on the theory that a value which is never persisted or reused
// couldn't be used to track anyone. On reflection that adds no real
// privacy protection over sending nothing at all: the server never reads
// or stores that value either way (see heartbeat.go), so the actual
// safety property lives entirely in what the *server* does with the
// request, not in what randomness the client throws away before sending
// it. Simpler to just send nothing, and simpler is easier to audit and
// trust.
//
// Never retried, never awaited by callers, and never blocks app boot —
// a failed heartbeat (relay unreachable, ad blocker, etc.) just means
// this one load doesn't get counted, which is an acceptable, disclosed
// gap for what is deliberately a soft usage signal, not a required
// feature.
export function sendClientHeartbeat(): void {
  fetch(heartbeatUrl, { method: 'POST' }).catch(() => {
    // Intentionally swallowed — see the comment above.
  })
}
