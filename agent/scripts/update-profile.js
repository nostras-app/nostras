// One-off: uploads a new avatar to Blossom and republishes the agent's
// kind:0 with an updated `about` + `picture`, preserving any other
// existing fields (fetch-then-merge, not wholesale replace — same
// discipline ProfileEditor.tsx already established for the client's own
// profile editing, for the identical reason: a blind replace would
// silently wipe fields this script doesn't know about).
import { WebSocket } from 'ws'
globalThis.WebSocket = WebSocket

import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { loadEnvFile } from '../src/env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnvFile(path.join(__dirname, '..', 'agent.env'))

const { loadOrCreateIdentity } = await import('../src/identity.js')
const { buildNdk, LISTEN_RELAY_URLS } = await import('../src/ndkClient.js')
const { fetchLatestReplaceableEvent } = await import('../src/fetchLatestReplaceable.js')

const AVATAR_PATH = process.argv[2]
const NEW_ABOUT = process.argv[3]

if (!AVATAR_PATH || !NEW_ABOUT) {
  console.error('Usage: node update-profile.js <image-path> "<new about text>"')
  process.exit(1)
}

const signer = loadOrCreateIdentity()
const ndk = buildNdk(signer)
await ndk.connect(10000)

// --- Blossom upload (BUD-11), same encoding this project already
// verified blossom.primal.net actually accepts (standard base64 with
// padding, not the spec's base64url-without-padding — see
// client/src/lib/blossom.ts's own comment on this exact mismatch).
const BLOSSOM_SERVER = 'https://blossom.primal.net'

const fileBuf = readFileSync(AVATAR_PATH)
const sha256 = createHash('sha256').update(fileBuf).digest('hex')

const authEvent = new NDKEvent(ndk, {
  kind: 24242,
  content: 'Upload file',
  tags: [
    ['t', 'upload'],
    ['x', sha256],
    ['expiration', String(Math.floor(Date.now() / 1000) + 300)],
  ],
})
await authEvent.sign()
const authHeader = `Nostr ${Buffer.from(JSON.stringify(authEvent.rawEvent())).toString('base64')}`

console.log('Uploading avatar to Blossom...')
const uploadRes = await fetch(`${BLOSSOM_SERVER}/upload`, {
  method: 'PUT',
  headers: { Authorization: authHeader, 'Content-Type': 'image/png' },
  body: fileBuf,
})
if (!uploadRes.ok) {
  console.error(`Upload failed (${uploadRes.status}):`, await uploadRes.text())
  process.exit(1)
}
const blob = await uploadRes.json()
console.log('Uploaded:', blob.url)

// --- Fetch-then-merge the current kind:0 (not a wholesale replace).
const lookupRelaySet = NDKRelaySet.fromRelayUrls(LISTEN_RELAY_URLS, ndk)
const existing = await fetchLatestReplaceableEvent(
  ndk,
  { kinds: [0], authors: [signer.pubkey] },
  lookupRelaySet,
  8000,
)

let current = {}
if (existing) {
  try {
    current = JSON.parse(existing.content)
  } catch {
    current = {}
  }
}

const updated = { ...current, about: NEW_ABOUT, picture: blob.url }

const profileEvent = new NDKEvent(ndk, {
  kind: 0,
  content: JSON.stringify(updated),
})
await profileEvent.publish(undefined, 8000)

console.log('\nPublished updated profile:')
console.log(JSON.stringify(updated, null, 2))

process.exit(0)
