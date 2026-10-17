import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, authorQueryRelaySet } from './ndk'
import { getCustomRelays, addCustomRelayUrl, isValidRelayUrl } from './customRelays'
import { fetchLatestReplaceableEvent } from './fetchLatestReplaceable'
import {
  loadLastSeenNotifications,
  saveLastSeenNotifications,
  loadSeenMessageWrapIds,
  saveSeenMessageWrapIds,
  MAX_SEEN_MESSAGE_WRAP_IDS,
} from './unreadState'
import { loadDmHiddenForSync, mergeDmHiddenFromSync } from './dmHidden'

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
// `list:<d>` = a NIP-51 follow set (kind:30000) of the active user, by its
// d tag — see hooks/useFollowSets.ts. Feed.tsx falls back to Global if that
// list no longer exists (deleted, or synced from a different identity).
export type FeedMode = 'following' | 'global' | `list:${string}`

export function isFeedMode(value: unknown): value is FeedMode {
  return (
    value === 'following' ||
    value === 'global' ||
    (typeof value === 'string' && value.startsWith('list:') && value.length > 5)
  )
}

export function loadFeedMode(): FeedMode {
  const stored = localStorage.getItem(FEED_MODE_KEY)
  return isFeedMode(stored) ? stored : 'global'
}

export type AppPreferences = {
  feedMode?: FeedMode
  customRelays?: string[]
  // Backs the nav rail's unread badges (NavRail.tsx). Synced (unlike a
  // purely local preference) specifically because the whole point of a
  // badge is not showing a stale unread count on a device you weren't
  // just using — reading something on your phone should clear the
  // badge on desktop too, not just on the phone. Notification events
  // carry a real, honest created_at, so a plain "seen up through this
  // timestamp" marker works for them; DM gift wraps do not (NIP-59
  // deliberately randomizes a wrap's own outer created_at), so those
  // instead sync a bounded set of already-seen wrap ids — see
  // lib/unreadState.ts's own comment on why.
  lastSeenNotificationsAt?: number
  seenMessageWrapIds?: string[]
  // DMs the user deleted on their side (lib/dmHidden.ts). Synced so a
  // message deleted on the phone stays gone on desktop too.
  dmHiddenWrapIds?: string[]
  dmClearedBefore?: Record<string, number>
}

// Deliberately small: only preferences that are (a) genuinely useful
// across devices and (b) not security-sensitive. Signer sessions, the
// NWC wallet connection string, and local identity keys all live in
// localStorage too but must never be published anywhere, encrypted or
// not — syncing those would be a real security regression, not a
// convenience.
function currentLocalPreferences(): AppPreferences {
  return {
    feedMode: loadFeedMode(),
    customRelays: getCustomRelays(),
    lastSeenNotificationsAt: loadLastSeenNotifications(),
    seenMessageWrapIds: loadSeenMessageWrapIds(),
    dmHiddenWrapIds: loadDmHiddenForSync().hiddenWrapIds,
    dmClearedBefore: loadDmHiddenForSync().clearedBefore,
  }
}

export async function fetchAppPreferences(pubkey: string): Promise<AppPreferences | null> {
  if (!ndk.signer) return null
  let event
  try {
    // fetchLatestReplaceableEvent, not plain ndk.fetchEvent(), as of
    // 2026-08-17 — even authorQueryRelaySet-scoped, fetchEvent()
    // hardcodes closeOnEose:true and can converge on a stale relay's
    // copy of this replaceable (kind:30078 + fixed "d" tag) event
    // before a slower relay's fresher one arrives — same race found
    // and fixed for useFollowing.ts/useFollowCounts.ts, see that dated
    // CLAUDE.md entry.
    event = await withTimeout(
      fetchLatestReplaceableEvent(
        { kinds: [KIND_APP_DATA], authors: [pubkey], '#d': [APP_DATA_D_TAG] },
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
// Publishing before this device has merged the synced copy would replace
// the relay's copy with this device's partial state (e.g. a fresh device
// would wipe every synced DM deletion and read marker). So every publish
// waits for the boot-time sync to finish first (it's bounded by
// FETCH_TIMEOUT_MS, so this never waits forever).
let bootSync: Promise<void> | null = null

export function syncPreferencesOnBoot(pubkey: string): Promise<void> {
  bootSync = fetchAppPreferences(pubkey)
    .then((prefs) => {
      if (prefs) applyFetchedPreferences(prefs)
    })
    .catch(() => {})
  return bootSync
}

export async function publishCurrentPreferences(): Promise<void> {
  if (!ndk.signer) return
  if (bootSync) await bootSync
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
// The notifications marker takes whichever is newer, local or remote —
// never regress: a slightly-stale remote snapshot (published before
// this device's own more recent read) must not resurrect an already-
// cleared badge as unread again. The seen-wrap-id set is a plain union
// (there's no single "newer" between two id sets the way there is for
// one timestamp), capped back down to the same bounded window it's
// always kept to.
export function applyFetchedPreferences(prefs: AppPreferences): void {
  if (isFeedMode(prefs.feedMode)) localStorage.setItem(FEED_MODE_KEY, prefs.feedMode)
  for (const url of prefs.customRelays ?? []) {
    if (isValidRelayUrl(url)) addCustomRelayUrl(url)
  }
  if (prefs.lastSeenNotificationsAt && prefs.lastSeenNotificationsAt > loadLastSeenNotifications()) {
    saveLastSeenNotifications(prefs.lastSeenNotificationsAt)
  }
  if (prefs.seenMessageWrapIds?.length) {
    const merged = Array.from(new Set([...loadSeenMessageWrapIds(), ...prefs.seenMessageWrapIds]))
    saveSeenMessageWrapIds(merged.slice(-MAX_SEEN_MESSAGE_WRAP_IDS))
  }
  mergeDmHiddenFromSync({ hiddenWrapIds: prefs.dmHiddenWrapIds, clearedBefore: prefs.dmClearedBefore })
}
