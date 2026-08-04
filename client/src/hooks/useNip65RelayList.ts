import { useCallback, useEffect, useState } from 'react'
import { NDKEvent, normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, localRelayUrl } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'

const normalizedLocalRelayUrl = normalizeRelayUrl(localRelayUrl)

export interface Nip65Entry {
  url: string
  read: boolean
  write: boolean
}

function parseNip65Tags(tags: string[][]): Nip65Entry[] {
  return tags
    .filter((t) => t[0] === 'r' && !!t[1])
    .map((t) => {
      const marker = t[2]
      return { url: t[1], read: marker !== 'write', write: marker !== 'read' }
    })
}

function entriesToTags(entries: Nip65Entry[]): string[][] {
  return entries.map((e) => {
    if (e.read && e.write) return ['r', e.url]
    return ['r', e.url, e.read ? 'read' : 'write']
  })
}

// NIP-51/NIP-65 kind:10002 relay list — the same fetch-then-republish
// pattern as useBookmark (kind:10003) and the mute list (kind:10000).
// Feeds the server's outbox aggregation (server/outbox.go), which reads
// OTHER users' kind:10002 lists to fetch their notes — this hook manages
// publishing the active user's own, so other clients/relays can find them.
export function useNip65RelayList() {
  const activeUser = useActiveUser()
  const [entries, setEntries] = useState<Nip65Entry[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeUser) {
      setEntries(null)
      return
    }
    let cancelled = false
    ndk
      .fetchEvent({ kinds: [10002], authors: [activeUser.pubkey] })
      .then((event) => {
        if (cancelled) return
        if (event) {
          setEntries(parseNip65Tags(event.tags))
        } else {
          // Sensible starting point for a user with no list yet, rather
          // than an empty editor.
          setEntries([{ url: normalizedLocalRelayUrl, read: true, write: true }])
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeUser])

  const save = useCallback(
    async (next: Nip65Entry[]) => {
      if (!activeUser) return
      setBusy(true)
      try {
        const valid = next.filter((e) => e.read || e.write)
        const event = new NDKEvent(ndk, {
          kind: 10002,
          tags: entriesToTags(valid),
          content: '',
        })
        await event.publish(devPublishRelaySet)
        setEntries(valid)
      } finally {
        setBusy(false)
      }
    },
    [activeUser],
  )

  return { entries, save, busy }
}
