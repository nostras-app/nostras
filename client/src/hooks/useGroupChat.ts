import { useCallback, useEffect, useState } from 'react'
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet } from '../lib/ndk'
import { useRelayStatus } from './useRelayStatus'

// NDK's NDKKind enum doesn't include NIP-29's delete-event (9005) or
// delete-group (9008) — real, ratified NIP-29 kinds NDK just hasn't
// added constants for. Cast at the point of use rather than piping
// `as NDKKind` through every call site.
const KIND_GROUP_DELETE_EVENT = 9005 as NDKKind

// See useNoteFeed.ts's comment — same missing-EOSE-fallback bug found
// across every long-lived subscription hook in this codebase.
const EOSE_FALLBACK_MS = 12000

export type GroupMessage = {
  id: string
  pubkey: string
  content: string
  createdAt: number
}

export const GROUP_CHAT_PUBLISH_TIMEOUT_MS = 8000

// Live subscription to kind:9 chat messages for one group, scoped to
// localRelaySet (see lib/groups.ts). Same subscribe/dedupe/eose/cleanup
// shape as useDirectMessages.ts, minus the decryption step — group chat
// in v1 (public + open) is plaintext, not gift-wrapped. Resubscribes on
// [groupId, generation] so a local-relay reconnect (generation bumps,
// see lib/relayStatus.ts) re-sends the REQ, matching the same fix
// useDirectMessages/useNoteFeed/useNotifications already rely on.
//
// Also subscribes to kind:9005 (delete-event) in the same filter, rather
// than a second subscription — the relay already admin-gates 9005 at
// write time (server/nip29.go), so any 9005 that exists here IS a
// legitimate deletion, no client-side re-verification needed. Deleted
// ids are tracked separately from the raw message list and only
// filtered out at read time (in the returned `messages`), not removed
// on arrival — a 9005 can genuinely arrive before the message it targets
// during initial backlog replay, and filtering only at read time is what
// makes that ordering not matter.
export function useGroupChat(groupId: string | null) {
  const [rawMessages, setRawMessages] = useState<GroupMessage[]>([])
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { generation } = useRelayStatus()

  useEffect(() => {
    if (!groupId) {
      setRawMessages([])
      setDeletedIds(new Set())
      setLoading(false)
      return
    }

    setRawMessages([])
    setDeletedIds(new Set())
    setLoading(true)
    const seenIds = new Set<string>()

    const sub = ndk.subscribe(
      { kinds: [9, KIND_GROUP_DELETE_EVENT], '#h': [groupId], limit: 200 },
      { relaySet: localRelaySet },
    )

    sub.on('event', (evt: NDKEvent) => {
      if (seenIds.has(evt.id)) return
      seenIds.add(evt.id)

      if (evt.kind === 9005) {
        const targetIds = evt.tags.filter((t) => t[0] === 'e').map((t) => t[1])
        if (targetIds.length === 0) return
        setDeletedIds((prev) => {
          const next = new Set(prev)
          for (const id of targetIds) next.add(id)
          return next
        })
        return
      }

      setRawMessages((prev) => {
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

    const eoseFallback = setTimeout(() => setLoading(false), EOSE_FALLBACK_MS)

    return () => {
      clearTimeout(eoseFallback)
      sub.stop()
    }
  }, [groupId, generation])

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!groupId || deletingMessageId) return
      setDeletingMessageId(messageId)
      setDeleteError(null)
      try {
        const event = new NDKEvent(ndk, {
          kind: 9005,
          tags: [
            ['h', groupId],
            ['e', messageId],
          ],
        })
        await event.publish(localRelaySet, GROUP_CHAT_PUBLISH_TIMEOUT_MS)
        // Optimistic — the relay's own OnEventSaved fan-out will also
        // deliver this same 9005 back through the live subscription
        // above, but that round-trip can lag; applying it locally too
        // means the deleter's own view updates immediately rather than
        // waiting on a relay echo of an event they just sent themselves.
        setDeletedIds((prev) => new Set(prev).add(messageId))
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : 'Failed to delete message')
      } finally {
        setDeletingMessageId(null)
      }
    },
    [groupId, deletingMessageId],
  )

  return {
    messages: rawMessages.filter((m) => !deletedIds.has(m.id)),
    loading,
    deleteMessage,
    deletingMessageId,
    deleteError,
  }
}
