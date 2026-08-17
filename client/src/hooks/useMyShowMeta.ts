import { useCallback, useEffect, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, authorQueryRelaySet } from '../lib/ndk'
import { useActiveUser } from './useActiveUser'
import { KIND_PODCAST_METADATA, parseShowMeta, withTimeout, type ShowMeta } from '../lib/podcast'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'

const PUBLISH_TIMEOUT_MS = 8000
const FETCH_TIMEOUT_MS = 8000

// Fetch-then-edit hook for the active user's own show metadata
// (kind:10154), matching the safety shape this project settled on after
// fixing the identical bug three times (useFollowing/useBookmark/
// useNip65RelayList): a loading guard so a save can't race the initial
// fetch, an explicit fetch timeout (scoped to authorQueryRelaySet, not
// left unscoped) and publish timeout, and a real surfaced error instead
// of a silent hang. Preserves any tags this editor doesn't know about
// (anything other than title/image/description/website) on save —
// same "spread, don't replace wholesale" discipline as ProfileEditor's
// kind:0 fix, in case a future co-host UI or another client's own
// extension adds fields here later.
export function useMyShowMeta() {
  const activeUser = useActiveUser()
  const [rawTags, setRawTags] = useState<string[][] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeUser) {
      setRawTags(null)
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    // fetchLatestReplaceableEvent, not plain ndk.fetchEvent(), as of
    // 2026-08-17 — even authorQueryRelaySet-scoped, fetchEvent()
    // hardcodes closeOnEose:true and can converge on a stale relay's
    // copy of this replaceable kind:10154 before a slower relay's
    // fresher one arrives (same race found and fixed for
    // useFollowing.ts/useFollowCounts.ts — see that dated CLAUDE.md
    // entry). withTimeout is now belt-and-suspenders (the fetch itself
    // never rejects, only ever resolves, possibly with null).
    withTimeout(
      fetchLatestReplaceableEvent(
        { kinds: [KIND_PODCAST_METADATA], authors: [activeUser.pubkey] },
        authorQueryRelaySet,
      ),
      FETCH_TIMEOUT_MS,
      'Timed out fetching show info',
    )
      .then((event) => {
        if (!cancelled) setRawTags(event?.tags ?? [])
      })
      .catch(() => {
        if (!cancelled) setRawTags([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeUser])

  const save = useCallback(
    async (next: ShowMeta): Promise<boolean> => {
      if (!activeUser || loading) return false
      setSaving(true)
      setError(null)
      try {
        const preserved = (rawTags ?? []).filter(
          (t) => !['title', 'image', 'description', 'website'].includes(t[0]),
        )
        const tags: string[][] = [...preserved, ['title', next.title.trim()]]
        if (next.image.trim()) tags.push(['image', next.image.trim()])
        if (next.description.trim()) tags.push(['description', next.description.trim()])
        if (next.website.trim()) tags.push(['website', next.website.trim()])
        const event = new NDKEvent(ndk, { kind: KIND_PODCAST_METADATA, content: '', tags })
        await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
        setRawTags(tags)
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save show info')
        return false
      } finally {
        setSaving(false)
      }
    },
    [activeUser, loading, rawTags],
  )

  return { meta: parseShowMeta(rawTags ?? []), loading, saving, error, save }
}
