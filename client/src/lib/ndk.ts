import NDK from '@nostr-dev-kit/ndk'

// Bootstrap relay set for local development. wss://localhost:7777 stands in
// for the self-hosted khatru node (server/) once it exists; the public
// relays are just so the feed isn't empty during early development.
export const explicitRelayUrls = [
  'ws://localhost:7777',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
]

export const ndk = new NDK({
  explicitRelayUrls,
})
