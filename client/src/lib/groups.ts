import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet } from './ndk'

// NIP-29 relay-based groups (v1: public + open only — see server/nip29.go
// for the full scope writeup). All group reads/writes go through
// localRelaySet, never devPublishRelaySet — communities are meant to live
// only on NOSTRAS's own self-hosted relay, and devPublishRelaySet now
// includes public relays in production builds (lib/ndk.ts), which would
// leak group state off our own relay. This is the first deliberate
// exception to the devPublishRelaySet-by-default convention every other
// fetch-then-republish hook in this codebase follows.

// Matches the 8s timeout used by every other publish in this codebase
// (useFollowing.ts, Composer.tsx, etc.) — NDK's own 2.5s default is tight
// given this relay's demonstrated occasional latency under load.
export const GROUP_PUBLISH_TIMEOUT_MS = 8000

// The relay does NOT mint/sign 39000/39001 itself (see server/nip29.go's
// create-group comment for why) — the client publishes them immediately
// after kind:9007 succeeds. Sequential awaits, not Promise.all: the
// relay's RejectEvent hook only recognizes the creator as admin once
// kind:9007 has actually been processed, so 39000/39001 must not be sent
// until that completes.
export async function publishCreateGroup(
  name: string,
  about: string,
  picture: string,
): Promise<string> {
  const creator = ndk.activeUser
  if (!creator) throw new Error('Not signed in')

  const id = crypto.randomUUID()

  const createEvent = new NDKEvent(ndk, { kind: 9007, tags: [['h', id]] })
  await createEvent.publish(localRelaySet, GROUP_PUBLISH_TIMEOUT_MS)

  const metaTags: string[][] = [['d', id]]
  if (name.trim()) metaTags.push(['name', name.trim()])
  if (about.trim()) metaTags.push(['about', about.trim()])
  if (picture.trim()) metaTags.push(['picture', picture.trim()])
  const metaEvent = new NDKEvent(ndk, { kind: 39000, tags: metaTags })
  await metaEvent.publish(localRelaySet, GROUP_PUBLISH_TIMEOUT_MS)

  const adminsEvent = new NDKEvent(ndk, {
    kind: 39001,
    tags: [
      ['d', id],
      ['p', creator.pubkey, 'admin'],
    ],
  })
  await adminsEvent.publish(localRelaySet, GROUP_PUBLISH_TIMEOUT_MS)

  return id
}

export async function sendGroupMessage(groupId: string, content: string): Promise<void> {
  const event = new NDKEvent(ndk, { kind: 9, tags: [['h', groupId]], content })
  await event.publish(localRelaySet, GROUP_PUBLISH_TIMEOUT_MS)
}
