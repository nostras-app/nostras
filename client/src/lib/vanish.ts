import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, localRelayUrl, localRelaySet } from './ndk'

// NIP-62 Request to Vanish. Deliberately targets NOSTRAS's own relay
// only (["relay", localRelayUrl]), not a broadcast to every relay this
// session publishes to — matches what was actually asked for ("no way
// to request erasure of their data from the relay") and this is the
// one relay actually built to genuinely honor it (see server/vanish.go:
// deletes stored notes/profile events and received DMs up through this
// request's own timestamp, and refuses to ever store them again).
// Published via localRelaySet, not devPublishRelaySet — the latter
// includes the public bootstrap relays in production, which don't
// implement this NIP and would just ignore or reject an unrecognized
// kind:62 event; there's no reason to send it there.
export async function requestVanish(reason?: string): Promise<void> {
  if (!ndk.signer) throw new Error('Not signed in')
  const event = new NDKEvent(ndk, {
    kind: 62,
    content: reason ?? '',
    tags: [['relay', localRelayUrl]],
  })
  await event.publish(localRelaySet, 8000)
}
