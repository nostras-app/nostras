import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from './ndk'

// Matches useFollowing.ts/useBookmark.ts/useNip65RelayList.ts's own
// explicit-timeout convention for publishes.
const PUBLISH_TIMEOUT_MS = 8000

// NIP-38 general status (kind:30315, d=general). Publishing with
// content='' is how the spec itself defines "clear the status" — same
// event shape either way, so clearUserStatus() below is just this with
// an empty string, not a separate mechanism.
export async function publishUserStatus(
  content: string,
  url?: string,
  expiresInSeconds?: number,
): Promise<void> {
  const tags: string[][] = [['d', 'general']]
  if (url?.trim()) tags.push(['r', url.trim()])
  if (expiresInSeconds) {
    tags.push(['expiration', String(Math.floor(Date.now() / 1000) + expiresInSeconds)])
  }

  const event = new NDKEvent(ndk, {
    kind: 30315,
    content,
    tags,
  })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
}

export function clearUserStatus(): Promise<void> {
  return publishUserStatus('')
}
