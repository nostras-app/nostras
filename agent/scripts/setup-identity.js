// One-off setup step, run manually after the daemon's first boot has
// generated an identity (or run this first — loadOrCreateIdentity()
// handles either order). Publishes a kind:0 profile and a kind:10050 DM
// relay list so the existing, already-proven discoverRecipientDmRelays()
// logic in the owner's own NOSTRAS client correctly routes a DM to this
// identity with zero new client-side code.
import { WebSocket } from 'ws'
globalThis.WebSocket = WebSocket

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { loadEnvFile } from '../src/env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnvFile(path.join(__dirname, '..', 'agent.env'))

const { loadOrCreateIdentity } = await import('../src/identity.js')
const { buildNdk, LISTEN_RELAY_URLS, NOSTRAS_RELAY_URL } = await import('../src/ndkClient.js')

const signer = loadOrCreateIdentity()
const ndk = buildNdk(signer)
await ndk.connect(10000)

const profile = new NDKEvent(ndk, {
  kind: 0,
  content: JSON.stringify({
    name: 'NOSTRAS Desktop Agent',
    about:
      "A local Claude Code daemon, DM me and I'll work on the NOSTRAS repo. " +
      'Runs only on my operator\'s own desktop — never public infrastructure.',
  }),
})
await profile.publish(undefined, 8000)
console.log('Published kind:0 profile')

const dmRelayList = new NDKEvent(ndk, {
  kind: 10050,
  content: '',
  tags: [['r', NOSTRAS_RELAY_URL], ['r', LISTEN_RELAY_URLS[1]]],
})
await dmRelayList.publish(undefined, 8000)
console.log('Published kind:10050 DM relay list')

console.log(`\nDone. Agent npub: ${signer.npub}`)
console.log(`Hex pubkey: ${signer.pubkey}`)
console.log('DM this npub from your own NOSTRAS session to talk to it.')

process.exit(0)
