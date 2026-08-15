import { useEffect, useState } from 'react'
import { ndk, authorQueryRelaySet } from '../lib/ndk'
import { withTimeout } from '../lib/podcast'
import { KIND_BADGE_AWARD, parseBadgeAward, type BadgeAward } from '../lib/badges'

const FETCH_TIMEOUT_MS = 8000

// Awards addressed to a given pubkey — tag-filtered (#p), not
// authors-filtered, so this doesn't route through NDK's authors-filtered
// CONNECTED-only relay race (the class of bug already fixed several
// times elsewhere in this app). The extra `.recipients.includes(pubkey)`
// filter below is what makes this list trustworthy as an "accept" source
// elsewhere — every entry it returns is genuinely `p`-tagged to this
// exact pubkey, not just something a relay happened to hand back.
//
// Real, separate bug found live during verification, not shipped: this
// originally left the query entirely unscoped, reasoning that a tag-only
// filter doesn't need authorQueryRelaySet — true for the CONNECTED-only
// race, but wrong for a different reason. ndk.fetchEvents() is a
// one-shot Promise (unlike ndk.subscribe(), which has its own eose-driven
// state and this app's own fallback-timer convention) — left unscoped,
// it queries NDK's full *default* relay pool, which can grow large via
// outbox discovery during ordinary browsing (this app's own documented,
// expected behavior). Confirmed live: a raw, unscoped fetchEvents() call
// with this exact filter shape genuinely never resolved within 45+
// real seconds in a session that had done heavy Global-feed browsing
// beforehand — one slow/unresponsive relay in a large dynamic pool is
// enough to stall the whole Promise. Scoping to authorQueryRelaySet (the
// same small, explicit, already-proven-fast relay set used throughout
// this app for exactly this class of concern) fixes it; the withTimeout
// wrapper below stays as defense in depth, not the primary fix.
export function useReceivedBadgeAwards(pubkey: string | undefined) {
  const [awards, setAwards] = useState<BadgeAward[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setAwards([])
    if (!pubkey) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    withTimeout(
      ndk.fetchEvents({ kinds: [KIND_BADGE_AWARD], '#p': [pubkey] }, undefined, authorQueryRelaySet),
      FETCH_TIMEOUT_MS,
      'Timed out loading badge awards',
    )
      .then((events) => {
        if (cancelled) return
        const parsed = [...events]
          .map(parseBadgeAward)
          .filter((a): a is BadgeAward => a !== null && a.recipients.includes(pubkey))
          .sort((a, b) => b.createdAt - a.createdAt)
        setAwards(parsed)
      })
      .catch(() => {
        if (!cancelled) setAwards([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pubkey])

  return { awards, loading }
}
