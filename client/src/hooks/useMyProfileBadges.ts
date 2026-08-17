import { useEffect, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, authorQueryRelaySet } from '../lib/ndk'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'
import { useActiveUser } from './useActiveUser'
import {
  KIND_PROFILE_BADGES,
  parseProfileBadgeTags,
  buildProfileBadgeTags,
  type ProfileBadgeEntry,
} from '../lib/badges'

const PUBLISH_TIMEOUT_MS = 8000

// Edit side of the Profile Badges list (kind:10008) — the active user's
// own accepted/displayed badges, with ordering. Same fetch-then-
// republish safety shape settled on after fixing the identical bug
// class three times elsewhere (useFollowing/useBookmark/
// useNip65RelayList/useMuteList): a loading guard against mutating
// before the current list is known, an explicit publish timeout, and a
// real surfaced error rather than a swallowed rejection.
//
// Security note, not just a style choice: accept() trusts whatever
// address/awardEventId it's given — it does not itself re-verify that a
// real award exists. That verification instead comes from WHERE this is
// called: BadgesSettings.tsx only ever calls accept() with values
// sourced from useReceivedBadgeAwards(activeUser.pubkey), which by
// construction only returns awards genuinely `p`-tagged to this exact
// pubkey. Wiring accept() to any other source would defeat that
// guarantee.
export function useMyProfileBadges() {
  const activeUser = useActiveUser()
  const [entries, setEntries] = useState<ProfileBadgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeUser) {
      setEntries([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    // fetchLatestReplaceableEvent, not plain ndk.fetchEvent() — even
    // authorQueryRelaySet-scoped, fetchEvent() hardcodes closeOnEose:true
    // and can converge on a stale relay's copy of this replaceable
    // kind:10008 list before a slower relay's fresher one arrives
    // (2026-08-17, see CLAUDE.md's dated entry). A stale copy here is a
    // real accept/remove/reorder data-loss risk, same reason the
    // loading guard above exists.
    fetchLatestReplaceableEvent(
      { kinds: [KIND_PROFILE_BADGES], authors: [activeUser.pubkey] },
      authorQueryRelaySet,
    )
      .then((event) => {
        if (cancelled) return
        setEntries(event ? parseProfileBadgeTags(event.tags) : [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeUser])

  async function publish(nextEntries: ProfileBadgeEntry[]): Promise<boolean> {
    if (!activeUser || busy || loading) return false
    setBusy(true)
    setError(null)
    try {
      const event = new NDKEvent(ndk, {
        kind: KIND_PROFILE_BADGES,
        tags: buildProfileBadgeTags(nextEntries),
        content: '',
      })
      await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
      setEntries(nextEntries)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update badge display')
      return false
    } finally {
      setBusy(false)
    }
  }

  function accept(address: string, awardEventId: string) {
    if (entries.some((e) => e.awardEventId === awardEventId)) return Promise.resolve(true)
    return publish([...entries, { address, awardEventId }])
  }

  function remove(awardEventId: string) {
    return publish(entries.filter((e) => e.awardEventId !== awardEventId))
  }

  function moveUp(index: number) {
    if (index <= 0 || index >= entries.length) return Promise.resolve(false)
    const next = [...entries]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    return publish(next)
  }

  function moveDown(index: number) {
    if (index < 0 || index >= entries.length - 1) return Promise.resolve(false)
    const next = [...entries]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    return publish(next)
  }

  return { entries, accept, remove, moveUp, moveDown, busy, loading, error }
}
