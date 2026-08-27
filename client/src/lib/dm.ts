import { NDKEvent, NDKRelaySet, giftWrap, giftUnwrap } from '@nostr-dev-kit/ndk'
import type { NDKUser } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, localRelayUrl, authorQueryRelaySet } from './ndk'
import { makeRelayConnectionFilter } from './relayFilter'
import { fetchLatestReplaceableEvent } from './fetchLatestReplaceable'

// NIP-17 direct messages: an unsigned kind:14 "rumor" gets sealed (kind:13)
// then gift-wrapped (kind:1059) via NDK's own giftWrap()/giftUnwrap()
// helpers — NIP-44 encryption + a throwaway ephemeral wrap key, so
// relays only see two random-looking pubkeys, not who's really talking to
// whom. NDK implements the crypto; this module just wires it to the app's
// signer/publish conventions.

export type DecryptedDm = {
  id: string
  wrapId: string
  senderPubkey: string
  recipientPubkey: string
  content: string
  createdAt: number
}

export const DM_RELAY_LIST_KIND = 10050
const RELAY_LIST_KIND = 10002

// Shared with useDmRelayList.ts, which reads/writes the active user's own
// kind:10050 list — same tag shape (flat "r" URLs, no read/write markers),
// named once rather than duplicated.
export function parseDmRelayTags(tags: string[][]): string[] {
  return tags.filter((t) => t[0] === 'r' && !!t[1]).map((t) => t[1])
}

// Matches the 8s per-publish convention used everywhere else in this
// codebase (Composer.tsx, useFollowing.ts, the group hooks, etc.).
const DM_PUBLISH_TIMEOUT_MS = 8000
// A real, previously-unbounded hang, not hypothetical: a recipient's
// kind:10002 write-relay list can legitimately have 20+ entries (a real
// production identity's list checked while diagnosing a stuck "Sending…"
// report had 24), and sendDirectMessage fans the gift wrap out to every
// one of them via NDKRelaySet.fromRelayUrls + a single Promise.all — one
// slow or hanging relay in that untrusted, discovered set (unlike
// devPublishRelaySet's small set of known-good relays) stalled the
// entire send indefinitely, with no per-call timeout anywhere in this
// file to bound it. This wraps the *whole* operation in one hard
// ceiling so the UI can never hang forever regardless of how many
// relays were discovered or how badly any one of them misbehaves —
// defense in depth on top of, not instead of, the per-publish timeouts
// below (a per-relay timeout bounds a slow OK/ack; this bounds
// everything, including a stall during the relay connection itself).
const DM_SEND_OVERALL_TIMEOUT_MS = 15000

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

// Same private/local-address guard used for outbox-discovered relays in
// ndk.ts (relayFilter.ts) — reused directly here rather than relying on
// NDK's pool-level relayConnectionFilter, because NDKRelaySet.fromRelayUrls()
// adds a relay to its own local set even when the pool refuses to register
// it (traced through NDK's source: pool.addRelay() checks the filter, but
// fromRelayUrls() unconditionally adds the NDKRelay object to the relay
// set it returns regardless of that refusal, and RelaySet.publish() iterates
// that local set directly — so the pool-level filter alone would NOT have
// stopped a publish attempt to a blocked address). A recipient's published
// relay list is untrusted third-party data, same category as outbox
// discovery, and could otherwise be used to make this app probe a
// visitor's private network.
const isAllowedRelayUrl = makeRelayConnectionFilter(localRelayUrl)

// Looks up where a recipient actually wants to receive DMs, so a message
// reaches them on whatever NIP-17 client they use — not just other
// NOSTRAS users pointed at the same relay via devPublishRelaySet. Per
// NIP-17, a kind:10050 "DM relay list" is preferred (a purpose-specific
// list, since gift wraps are meant to avoid leaking to a user's regular
// read/write relays and blending into that traffic defeats the point);
// falls back to their general NIP-65 kind:10002 write relays if they
// haven't published one. Returns [] (not a throw) if neither exists or
// the lookup fails — sendDirectMessage still works via devPublishRelaySet
// alone in that case, just with the same local-only reach it always had.
export async function discoverRecipientDmRelays(pubkey: string): Promise<string[]> {
  try {
    // Scoped to authorQueryRelaySet — same unscoped-authors-filter bug
    // class already found and fixed elsewhere in this app (see
    // authorQueryRelaySet's own comment in ndk.ts). Without this, a race
    // against NDK's CONNECTED-only relay fallback could make a real
    // recipient relay list look empty, silently falling back to
    // devPublishRelaySet's local-only reach — the exact "the message
    // never actually reached the recipient's real client" failure mode
    // this whole function exists to prevent in the first place.
    //
    // Uses fetchLatestReplaceableEvent, not plain ndk.fetchEvent(), as
    // of 2026-08-17 — even scoped, fetchEvent() hardcodes
    // closeOnEose:true and can converge on a stale relay's copy of these
    // replaceable lists (kind:10050/10002) before a slower relay's
    // fresher one arrives — same race found and fixed for
    // useFollowing.ts/useFollowCounts.ts (see that dated CLAUDE.md
    // entry). A stale DM relay list here has the same real consequence
    // this whole function was built to avoid: a message silently never
    // reaching the recipient's actual current client.
    const dmList = await fetchLatestReplaceableEvent(
      { kinds: [DM_RELAY_LIST_KIND], authors: [pubkey] },
      authorQueryRelaySet,
    )
    const dmRelays = dmList ? parseDmRelayTags(dmList.tags) : []
    if (dmRelays.length > 0) return dmRelays.filter(isAllowedRelayUrl)

    const relayList = await fetchLatestReplaceableEvent(
      { kinds: [RELAY_LIST_KIND], authors: [pubkey] },
      authorQueryRelaySet,
    )
    const writeRelays =
      relayList?.tags
        .filter((t) => t[0] === 'r' && !!t[1] && t[2] !== 'read')
        .map((t) => t[1]) ?? []
    return writeRelays.filter(isAllowedRelayUrl)
  } catch {
    return []
  }
}

// NIP-17 expects a copy of the gift wrap addressed to the sender too, so
// a conversation still shows the sender's own sent messages on reload —
// without this, only the recipient's copy would ever decrypt for us.
export async function sendDirectMessage(recipient: NDKUser, content: string): Promise<void> {
  const me = ndk.activeUser
  if (!ndk.signer || !me) throw new Error('No signer connected')

  const rumor = new NDKEvent(ndk, {
    kind: 14,
    content,
    tags: [['p', recipient.pubkey]],
    created_at: Math.floor(Date.now() / 1000),
  })

  const [wrapForRecipient, wrapForSelf, recipientRelayUrls] = await Promise.all([
    giftWrap(rumor, recipient),
    giftWrap(rumor, me),
    discoverRecipientDmRelays(recipient.pubkey),
  ])

  const publishes = [
    wrapForRecipient.publish(devPublishRelaySet, DM_PUBLISH_TIMEOUT_MS),
    wrapForSelf.publish(devPublishRelaySet, DM_PUBLISH_TIMEOUT_MS),
  ]
  if (recipientRelayUrls.length > 0) {
    const recipientRelaySet = NDKRelaySet.fromRelayUrls(recipientRelayUrls, ndk)
    publishes.push(wrapForRecipient.publish(recipientRelaySet, DM_PUBLISH_TIMEOUT_MS))
  }

  await withTimeout(
    Promise.all(publishes),
    DM_SEND_OVERALL_TIMEOUT_MS,
    'Sending timed out — one or more relays may be unreachable',
  )
}

// Returns null for anything that doesn't decrypt/parse as a valid rumor —
// e.g. a gift wrap addressed to someone else that happened to also
// mention us, or a malformed event. Failing closed here (skip, don't
// throw) matters since this runs per-event inside a live subscription.
export async function decryptGiftWrap(wrap: NDKEvent): Promise<DecryptedDm | null> {
  try {
    const rumor = await giftUnwrap(wrap, undefined, ndk.signer)
    const recipientTag = rumor.tags.find((t) => t[0] === 'p')
    if (!rumor.pubkey || !recipientTag?.[1] || !rumor.content) return null
    return {
      id: rumor.id,
      wrapId: wrap.id,
      senderPubkey: rumor.pubkey,
      recipientPubkey: recipientTag[1],
      // The rumor's created_at is the real send time; the wrap's own
      // created_at is deliberately randomized by NIP-59 to prevent
      // timing correlation across gift wraps, so it's never used for
      // display.
      createdAt: rumor.created_at ?? 0,
      content: rumor.content,
    }
  } catch {
    return null
  }
}
