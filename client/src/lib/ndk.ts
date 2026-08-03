import NDK, { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { getDevSigner } from './signer'

// Bootstrap relay set for local development. ws://localhost:7777 is the
// self-hosted khatru node (server/); the public relays are just so the feed
// isn't empty during early development.
export const localRelayUrl = 'ws://localhost:7777'

export const publicRelayUrls = ['wss://relay.damus.io', 'wss://relay.primal.net']

export const explicitRelayUrls = [localRelayUrl, ...publicRelayUrls]

export const ndk = new NDK({
  explicitRelayUrls,
  signer: getDevSigner(),
})

// Publishing during development should only hit our own relay — the public
// relays above are read-only feed sources here, not somewhere dev/test
// notes should get broadcast to the real network.
export const devPublishRelaySet = NDKRelaySet.fromRelayUrls(
  [localRelayUrl],
  ndk,
)
