import { NDKEvent, giftWrap, giftUnwrap } from '@nostr-dev-kit/ndk'
import type { NDKUser } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from './ndk'

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

  const [wrapForRecipient, wrapForSelf] = await Promise.all([
    giftWrap(rumor, recipient),
    giftWrap(rumor, me),
  ])

  await Promise.all([
    wrapForRecipient.publish(devPublishRelaySet),
    wrapForSelf.publish(devPublishRelaySet),
  ])
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
