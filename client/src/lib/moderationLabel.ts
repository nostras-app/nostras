import { ndk, localRelaySet } from './ndk'
import { withTimeout } from './podcast'

const MODERATION_NAMESPACE = 'org.nostras.moderation'
const MODERATION_LOOKUP_TIMEOUT_MS = 8000

// NIP-32: looks up an existing kind:1985 label already published for
// this event (by NOSTRAS's own spam/scam-classification DVM — see
// server/cmd/dvm/main.go's publishModerationLabel) before running a
// fresh, potentially-paid classification job. Labels only ever land on
// the local relay (the DVM only ever publishes to its own relay
// connection, never the public pool), so this is scoped there rather
// than the full pool — querying elsewhere would have zero chance of
// finding anything.
//
// ndk.fetchEvents() (plural) has no internal NDK timeout, unlike the
// singular fetchEvent() — found via the health-check skill's own
// regression audit for this exact missing-timeout shape (see
// BookmarksView.tsx's own fix, same session), not from a live user
// report this time.
export async function findExistingModerationLabel(
  eventId: string,
): Promise<{ verdict: string; reason: string } | null> {
  const events = await withTimeout(
    ndk.fetchEvents(
      { kinds: [1985], '#e': [eventId], '#L': [MODERATION_NAMESPACE] },
      { closeOnEose: true },
      localRelaySet,
    ),
    MODERATION_LOOKUP_TIMEOUT_MS,
    'Timed out checking for an existing moderation label',
  )
  if (events.size === 0) return null

  const latest = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
  const verdict = latest.tags.find((t) => t[0] === 'l')?.[1]
  if (!verdict) return null
  return { verdict, reason: latest.content }
}
