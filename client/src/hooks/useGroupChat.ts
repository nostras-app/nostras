import { useEffect, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet } from '../lib/ndk'
import { useRelayStatus } from './useRelayStatus'

export type GroupMessage = {
  id: string
  pubkey: string
  content: string
  createdAt: number
}

// Live subscription to kind:9 chat messages for one group, scoped to
// localRelaySet (see lib/groups.ts). Same subscribe/dedupe/eose/cleanup
// shape as useDirectMessages.ts, minus the decryption step — group chat
// in v1 (public + open) is plaintext, not gift-wrapped. Resubscribes on
// [groupId, generation] so a local-relay reconnect (generation bumps,
// see lib/relayStatus.ts) re-sends the REQ, matching the same fix
// useDirectMessages/useNoteFeed/useNotifications already rely on.
export function useGroupChat(groupId: string | null) {
  const [messages, setMessages] = useState<GroupMessage[]>([])
  const [loading, setLoading] = useState(true)
  const { generation } = useRelayStatus()

  useEffect(() => {
    if (!groupId) {
      setMessages([])
      setLoading(false)
      return
    }

    setMessages([])
    setLoading(true)
    const seenIds = new Set<string>()

    const sub = ndk.subscribe({ kinds: [9], '#h': [groupId], limit: 200 }, { relaySet: localRelaySet })

    sub.on('event', (evt: NDKEvent) => {
      if (seenIds.has(evt.id)) return
      seenIds.add(evt.id)
      setMessages((prev) => {
        if (prev.some((m) => m.id === evt.id)) return prev
        const next: GroupMessage = {
          id: evt.id,
          pubkey: evt.pubkey,
          content: evt.content,
          createdAt: evt.created_at ?? 0,
        }
        return [...prev, next].sort((a, b) => a.createdAt - b.createdAt)
      })
    })

    sub.on('eose', () => setLoading(false))

    return () => sub.stop()
  }, [groupId, generation])

  return { messages, loading }
}
