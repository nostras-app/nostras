import { useCallback, useEffect, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'

// kind:3 contact list — same fetch-then-republish pattern as useBookmark
// (kind:10003) and the mute list. `p` tags are the followed pubkeys;
// toggle() only ever adds/removes the one `p` tag it's touching and
// preserves everything else about the list (other tags, content) as-is,
// since some clients still put legacy relay-list JSON in kind:3's content.
export function useFollowing() {
  const activeUser = useActiveUser()
  const [pubkeys, setPubkeys] = useState<string[]>([])
  const [tags, setTags] = useState<string[][]>([])
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!activeUser) {
      setPubkeys([])
      setTags([])
      setContent('')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    ndk.fetchEvent({ kinds: [3], authors: [activeUser.pubkey] }).then((event) => {
      if (cancelled) return
      const nextTags = event?.tags ?? []
      setTags(nextTags)
      setContent(event?.content ?? '')
      setPubkeys(nextTags.filter((t) => t[0] === 'p' && !!t[1]).map((t) => t[1]))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [activeUser])

  const isFollowing = useCallback((pubkey: string) => pubkeys.includes(pubkey), [pubkeys])

  const toggle = useCallback(
    async (pubkey: string) => {
      if (!activeUser || busy) return
      setBusy(pubkey)
      try {
        const currentlyFollowing = pubkeys.includes(pubkey)
        const nextTags = currentlyFollowing
          ? tags.filter((t) => !(t[0] === 'p' && t[1] === pubkey))
          : [...tags, ['p', pubkey]]
        const event = new NDKEvent(ndk, { kind: 3, tags: nextTags, content })
        await event.publish(devPublishRelaySet)
        setTags(nextTags)
        setPubkeys(nextTags.filter((t) => t[0] === 'p' && !!t[1]).map((t) => t[1]))
      } finally {
        setBusy(null)
      }
    },
    [activeUser, pubkeys, tags, content, busy],
  )

  return { pubkeys, isFollowing, toggle, loading, busy }
}
