import { useEffect, useState } from 'react'
import { authorQueryRelaySet } from '../lib/ndk'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'
import { KIND_PROFILE_BADGES, parseProfileBadgeTags, type ProfileBadgeEntry } from '../lib/badges'

// Read-only: any pubkey's accepted, ordered badge display list
// (kind:10008), for rendering on a profile (own or someone else's).
// authors-filtered, so scoped to authorQueryRelaySet like every other
// profile-adjacent authors-filtered fetch in this app. Note: this shows
// whatever the profile owner's own client published — same
// "shown as this profile's own claim, not independently re-verified"
// posture NIP-39's linked accounts already established for a
// structurally similar situation, not glossed over as more certain than
// it is.
export function useProfileBadges(pubkey: string | undefined): ProfileBadgeEntry[] {
  const [entries, setEntries] = useState<ProfileBadgeEntry[]>([])

  useEffect(() => {
    setEntries([])
    if (!pubkey) return
    let cancelled = false
    // fetchLatestReplaceableEvent, not plain ndk.fetchEvent() — even
    // authorQueryRelaySet-scoped, fetchEvent() hardcodes
    // closeOnEose:true and can converge on a stale relay's copy of this
    // replaceable kind:10008 before a slower relay's fresher one
    // arrives (2026-08-17, see CLAUDE.md's dated entry for the full
    // mechanism, first found for useFollowing.ts/useFollowCounts.ts).
    fetchLatestReplaceableEvent({ kinds: [KIND_PROFILE_BADGES], authors: [pubkey] }, authorQueryRelaySet)
      .then((event) => {
        if (cancelled || !event) return
        setEntries(parseProfileBadgeTags(event.tags))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pubkey])

  return entries
}
