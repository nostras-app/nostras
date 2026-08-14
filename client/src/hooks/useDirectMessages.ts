import { useEffect, useMemo, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'
import { useRelayStatus } from './useRelayStatus'
import { decryptGiftWrap, type DecryptedDm } from '../lib/dm'

// Real bug found across every long-lived subscription hook in this
// codebase, not just here (see useNoteFeed.ts's own comment for the
// full writeup): `loading` only ever cleared via the subscription's
// `eose` event, with no fallback if a queried relay never reports it.
const EOSE_FALLBACK_MS = 12000

export type Conversation = {
  peerPubkey: string
  messages: DecryptedDm[]
  lastMessage: DecryptedDm
}

// Live subscription to kind:1059 gift wraps tagging us, same long-lived
// pattern as useNotifications — decrypts each as it arrives (giftUnwrap
// needs the signer, so this can't be done relay-side) and groups the
// result into per-peer conversations for MessagesView.
export function useDirectMessages() {
  const activeUser = useActiveUser()
  const [messages, setMessages] = useState<DecryptedDm[]>([])
  const [loading, setLoading] = useState(true)
  const { generation } = useRelayStatus()

  useEffect(() => {
    if (!activeUser || !ndk.signer) {
      setMessages([])
      setLoading(false)
      return
    }

    setMessages([])
    setLoading(true)
    const seenWrapIds = new Set<string>()

    const sub = ndk.subscribe({
      kinds: [1059],
      '#p': [activeUser.pubkey],
      limit: 200,
    })

    sub.on('event', (wrap: NDKEvent) => {
      if (seenWrapIds.has(wrap.id)) return
      seenWrapIds.add(wrap.id)
      decryptGiftWrap(wrap).then((decrypted) => {
        if (!decrypted) return
        setMessages((prev) => {
          if (prev.some((m) => m.wrapId === decrypted.wrapId)) return prev
          return [...prev, decrypted].sort((a, b) => a.createdAt - b.createdAt)
        })
      })
    })

    sub.on('eose', () => setLoading(false))

    const eoseFallback = setTimeout(() => setLoading(false), EOSE_FALLBACK_MS)

    return () => {
      clearTimeout(eoseFallback)
      sub.stop()
    }
  }, [activeUser, generation])

  const conversations = useMemo<Conversation[]>(() => {
    if (!activeUser) return []
    const byPeer = new Map<string, DecryptedDm[]>()
    for (const msg of messages) {
      const peer = msg.senderPubkey === activeUser.pubkey ? msg.recipientPubkey : msg.senderPubkey
      const list = byPeer.get(peer) ?? []
      list.push(msg)
      byPeer.set(peer, list)
    }
    return Array.from(byPeer.entries())
      .map(([peerPubkey, msgs]) => ({
        peerPubkey,
        messages: msgs,
        lastMessage: msgs[msgs.length - 1],
      }))
      .sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt)
  }, [messages, activeUser])

  return { conversations, loading }
}
