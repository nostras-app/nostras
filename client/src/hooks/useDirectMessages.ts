import { useEffect, useMemo, useRef, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'
import { useRelayStatus } from './useRelayStatus'
import { decryptGiftWrap, type DecryptedDm } from '../lib/dm'

// See useNoteFeed.ts's own comment — same missing-EOSE-fallback bug
// found across every long-lived subscription hook in this codebase.
const EOSE_FALLBACK_MS = 12000

export type Conversation = {
  peerPubkey: string
  messages: DecryptedDm[]
  lastMessage: DecryptedDm
}

// Real, live performance issue caught directly (2026-08-14): every view
// in this app stays mounted (see App.tsx), so this subscription used to
// decrypt EVERY gift wrap the instant it arrived, regardless of whether
// Messages was even the active view. For a NIP-07 browser extension
// that's free — decryption happens in-process, no network cost — but
// for a NIP-46 remote signer, every single decrypt is a full network
// round trip (encrypt a request, publish it, wait for the bunker to
// notice and respond). Confirmed live: a `nak bunker` terminal firing
// ~20 rapid nip44_decrypt requests from ordinary background use, with
// Messages never actually opened — NDK's own giftUnwrap() needs two
// decrypt calls per wrap (unwrap the outer seal, then unseal the inner
// rumor), so a real inbox of ~20 wraps means ~40 round-tripped bunker
// calls, all firing in a burst no matter what page is actually open.
//
// Fixed by decrypting lazily: raw wraps are always collected as they
// arrive (cheap — a plain subscription, no signer involved at all), but
// actual decryption only runs once `active` (Messages is the view
// actually being looked at) is true — catching up on whatever arrived
// while inactive, then continuing to decrypt live while the view stays
// open. `active` is read through a ref inside the event handler so the
// subscription itself (keyed on [activeUser, generation]) never needs
// to restart just because the user switches views.
export function useDirectMessages(active: boolean) {
  const activeUser = useActiveUser()
  const [messages, setMessages] = useState<DecryptedDm[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  // Every wrap id seen this mount, decrypted or still pending — exposed
  // so App.tsx's unread-DM badge can react to a *raw* wrap's arrival
  // without needing it decrypted first. NIP-59 deliberately randomizes
  // a wrap's own outer `created_at` (see the comment on `messages`'s own
  // sort elsewhere in this codebase), so there is no real timestamp to
  // compare against a "last seen at" marker the way notifications can —
  // App.tsx instead persists a set of already-seen wrap ids and diffs
  // against this list. Deliberately does not itself decrypt anything;
  // this is purely bookkeeping over ids that are already free to know
  // (they're right there in the subscription's own 'event' callback).
  const [wrapIds, setWrapIds] = useState<string[]>([])
  const { generation } = useRelayStatus()

  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])

  const pendingWrapsRef = useRef<Map<string, NDKEvent>>(new Map())
  const decryptOneRef = useRef<(wrap: NDKEvent) => void>(() => {})
  decryptOneRef.current = (wrap: NDKEvent) => {
    pendingWrapsRef.current.delete(wrap.id)
    setPendingCount(pendingWrapsRef.current.size)
    decryptGiftWrap(wrap).then((decrypted) => {
      if (!decrypted) return
      setMessages((prev) => {
        if (prev.some((m) => m.wrapId === decrypted.wrapId)) return prev
        return [...prev, decrypted].sort((a, b) => a.createdAt - b.createdAt)
      })
    })
  }

  useEffect(() => {
    if (!activeUser || !ndk.signer) {
      setMessages([])
      setLoading(false)
      pendingWrapsRef.current.clear()
      setPendingCount(0)
      return
    }

    setMessages([])
    setLoading(true)
    pendingWrapsRef.current.clear()
    setPendingCount(0)
    setWrapIds([])
    const seenWrapIds = new Set<string>()

    const sub = ndk.subscribe({
      kinds: [1059],
      '#p': [activeUser.pubkey],
      limit: 200,
    })

    sub.on('event', (wrap: NDKEvent) => {
      if (seenWrapIds.has(wrap.id)) return
      seenWrapIds.add(wrap.id)
      setWrapIds((prev) => [...prev, wrap.id])
      if (activeRef.current) {
        decryptOneRef.current(wrap)
      } else {
        pendingWrapsRef.current.set(wrap.id, wrap)
        setPendingCount(pendingWrapsRef.current.size)
      }
    })

    sub.on('eose', () => setLoading(false))

    const eoseFallback = setTimeout(() => setLoading(false), EOSE_FALLBACK_MS)

    return () => {
      clearTimeout(eoseFallback)
      sub.stop()
    }
  }, [activeUser, generation])

  // Catch up on anything that arrived while Messages wasn't open, the
  // moment it becomes active — and nothing to do when it isn't.
  useEffect(() => {
    if (!active) return
    for (const wrap of pendingWrapsRef.current.values()) {
      decryptOneRef.current(wrap)
    }
  }, [active])

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

  // True while Messages is open and there's at least one raw wrap still
  // waiting on a signer round trip — lets the UI show "Decrypting…"
  // instead of a misleading "No messages yet" flash while a slow (e.g.
  // bunker) signer catches up on a real inbox.
  const decrypting = active && pendingCount > 0

  return { conversations, loading, decrypting, wrapIds }
}
