import { NDKEvent, NDKRelaySet, giftWrap, giftUnwrap } from '@nostr-dev-kit/ndk'
import type { NDKUser } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, localRelayUrl } from './ndk'
import { makeRelayConnectionFilter } from './relayFilter'

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

const DM_RELAY_LIST_KIND = 10050
const RELAY_LIST_KIND = 10002

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
    const dmList = await ndk.fetchEvent({ kinds: [DM_RELAY_LIST_KIND], authors: [pubkey] })
    const dmRelays = dmList?.tags.filter((t) => t[0] === 'r' && !!t[1]).map((t) => t[1]) ?? []
    if (dmRelays.length > 0) return dmRelays.filter(isAllowedRelayUrl)

    const relayList = await ndk.fetchEvent({ kinds: [RELAY_LIST_KIND], authors: [pubkey] })
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
    wrapForRecipient.publish(devPublishRelaySet),
    wrapForSelf.publish(devPublishRelaySet),
  ]
  if (recipientRelayUrls.length > 0) {
    const recipientRelaySet = NDKRelaySet.fromRelayUrls(recipientRelayUrls, ndk)
    publishes.push(wrapForRecipient.publish(recipientRelaySet))
  }

  await Promise.all(publishes)
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
