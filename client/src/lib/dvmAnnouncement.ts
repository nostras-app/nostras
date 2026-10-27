import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet } from './ndk'
import { withTimeout } from './podcast'

const DVM_HANDLER_D_TAG = 'nostras-dvm'
const KIND_HANDLER_ANNOUNCEMENT = 31990
const DVM_ANNOUNCEMENT_TIMEOUT_MS = 8000

// The NOSTRAS DVM's current kind:31990 NIP-89 announcement on our relay.
// Every DVM identity publishes under the same `d` tag, and announcements
// from older identities can stay on the relay (147 of them did until
// 2026-10-27), each with its own pubkey, articleEncryptionPubkey and
// communityAdminPubkey. fetchEvent() settles on whichever copy arrives
// first, so this fetches them all and keeps the newest: the DVM
// republishes on every (re)connect, so newest = current.
export async function fetchNewestDvmAnnouncement(): Promise<NDKEvent | null> {
  const events = await withTimeout(
    ndk.fetchEvents({ kinds: [KIND_HANDLER_ANNOUNCEMENT], '#d': [DVM_HANDLER_D_TAG] }, undefined, localRelaySet),
    DVM_ANNOUNCEMENT_TIMEOUT_MS,
    'Timed out looking up the DVM',
  )
  let newest: NDKEvent | null = null
  for (const e of events) {
    if (!newest || (e.created_at ?? 0) > (newest.created_at ?? 0)) newest = e
  }
  return newest
}
