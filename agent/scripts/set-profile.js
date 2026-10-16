// Republishes the agent's kind:0 with new name/about/lud16, merged onto the
// current profile (fetch-then-merge, same reason as update-profile.js: a
// blind replace would wipe fields like `picture`). Prints the result and
// confirms it by reading it back from the listen relays.
//
// Usage: node scripts/set-profile.js '{"name":"...","about":"...","lud16":"..."}'
import { WebSocket } from 'ws'
globalThis.WebSocket = WebSocket

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { loadEnvFile } from '../src/env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnvFile(path.join(__dirname, '..', 'agent.env'))

const { loadOrCreateIdentity } = await import('../src/identity.js')
const { buildNdk, LISTEN_RELAY_URLS } = await import('../src/ndkClient.js')
const { fetchLatestReplaceableEvent } = await import('../src/fetchLatestReplaceable.js')

let changes
try {
  changes = JSON.parse(process.argv[2] ?? '')
} catch {
  console.error(`Usage: node scripts/set-profile.js '{"name":"...","about":"..."}'`)
  process.exit(1)
}

const signer = loadOrCreateIdentity()
const ndk = buildNdk(signer)
await ndk.connect(10000)

const relaySet = NDKRelaySet.fromRelayUrls(LISTEN_RELAY_URLS, ndk)
const existing = await fetchLatestReplaceableEvent(
  ndk,
  { kinds: [0], authors: [signer.pubkey] },
  relaySet,
  8000,
)
if (!existing) {
  console.error('Could not fetch the current profile; refusing to publish a partial one.')
  process.exit(1)
}

const updated = { ...JSON.parse(existing.content), ...changes }
const event = new NDKEvent(ndk, { kind: 0, content: JSON.stringify(updated) })
await event.publish(undefined, 8000)
console.log(JSON.stringify(updated, null, 2))
process.exit(0)
