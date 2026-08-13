import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, authorQueryRelaySet } from './ndk'
import { getCustomRelays, addCustomRelayUrl, isValidRelayUrl } from './customRelays'

// Real, previously-unbounded hang caught live while verifying this, not
// hypothetical: ndk.fetchEvent() with no explicit timeout genuinely
// never resolved during a two-device sync test (3+ seconds, no error,
// no result) — the same bug class already found and fixed for
// paidArticles.ts/remoteSigner.ts/dm.ts. Same pattern reused here
// rather than a shared helper, matching this codebase's own existing
// precedent of a small per-file copy over one shared utility for this.
const FETCH_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// NIP-78: app-specific data. Kind 30078 (addressable — a fresh publish
// always replaces the prior snapshot, so this is a plain "overwrite the
// whole blob" write, not tag-preserving surgery the way NIP-51 lists
// need). The spec itself is silent on encryption ("content and other
// tags can be anything or in any format"), but this is genuinely the
// user's own private preference data — no one else needs to read it —
// so it's NIP-44 self-encrypted (recipient = the same pubkey) rather
// than published as a plain readable blob. Every signer type this app
// supports already implements encrypt/decrypt to an arbitrary pubkey,
// so encrypting to yourself costs nothing extra.
export const KIND_APP_DATA = 30078
const APP_DATA_D_TAG = 'nostras-preferences'
const PUBLISH_TIMEOUT_MS = 8000

export const FEED_MODE_KEY = 'nostras:feed-mode'
export type FeedMode = 'following' | 'global'

export function loadFeedMode(): FeedMode {
  return localStorage.getItem(FEED_MODE_KEY) === 'following' ? 'following' : 'global'
}

export type AppPreferences = {
  feedMode?: FeedMode
  customRelays?: string[]
}

// Deliberately small: only preferences that are (a) genuinely useful
// across devices and (b) not security-sensitive. Signer sessions, the
// NWC wallet connection string, and local identity keys all live in
// localStorage too but must never be published anywhere, encrypted or
// not — syncing those would be a real security regression, not a
// convenience. Feed mode and the custom relay list are the only two
// current localStorage values that are both safe and worth syncing.
function currentLocalPreferences(): AppPreferences {
  return {
    feedMode: loadFeedMode(),
    customRelays: getCustomRelays(),
  }
}

export async function fetchAppPreferences(pubkey: string): Promise<AppPreferences | null> {
  if (!ndk.signer) return null
  let event
  try {
    event = await withTimeout(
      ndk.fetchEvent(
        { kinds: [KIND_APP_DATA], authors: [pubkey], '#d': [APP_DATA_D_TAG] },
        undefined,
        authorQueryRelaySet,
      ),
      FETCH_TIMEOUT_MS,
      'Timed out fetching app preferences',
    )
  } catch {
    return null
  }
  if (!event) return null
  try {
    const plaintext = await ndk.signer.decrypt(event.author, event.content, 'nip44')
    return JSON.parse(plaintext) as AppPreferences
  } catch {
    // Undecryptable (a different identity's leftover event, corrupt
    // content, etc.) — treat exactly like "no synced preferences yet"
    // rather than surfacing an error for something this device can't
    // act on either way.
    return null
  }
}

// Publishes the device's *current* full preference snapshot — reads
// fresh from localStorage/customRelays.ts each call rather than taking
// a snapshot as a parameter, so every call site (a feed-mode toggle, a
// relay add/remove) can just fire-and-forget this without first having
// to gather the other fields itself.
export async function publishCurrentPreferences(): Promise<void> {
  if (!ndk.signer) return
  const prefs = currentLocalPreferences()
  const user = await ndk.signer.user()
  const plaintext = JSON.stringify(prefs)
  const encrypted = await ndk.signer.encrypt(user, plaintext, 'nip44')
  const event = new NDKEvent(ndk, {
    kind: KIND_APP_DATA,
    content: encrypted,
    tags: [['d', APP_DATA_D_TAG]],
  })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
}

// Merges a remote snapshot into this device's own local state — a
// simple union, not full bidirectional sync: a relay this device
// doesn't have yet gets added locally, nothing gets removed just
// because a remote snapshot omits it (this device may have added
// relays of its own since the last sync). Feed mode is a straight
// overwrite, one value, nothing to merge. A newly-added relay needs a
// reload to actually connect — same as any locally-added custom relay
// (see customRelays.ts) — this only updates storage, not the live pool.
export function applyFetchedPreferences(prefs: AppPreferences): void {
  if (prefs.feedMode) localStorage.setItem(FEED_MODE_KEY, prefs.feedMode)
  for (const url of prefs.customRelays ?? []) {
    if (isValidRelayUrl(url)) addCustomRelayUrl(url)
  }
}
