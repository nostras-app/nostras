import { ndk, localRelaySet } from './ndk'

const MODERATION_NAMESPACE = 'org.nostras.moderation'

// NIP-32: looks up an existing kind:1985 label already published for
// this event (by NOSTRAS's own spam/scam-classification DVM — see
// server/cmd/dvm/main.go's publishModerationLabel) before running a
// fresh, potentially-paid classification job. Labels only ever land on
// the local relay (the DVM only ever publishes to its own relay
// connection, never the public pool), so this is scoped there rather
// than the full pool — querying elsewhere would have zero chance of
// finding anything.
export async function findExistingModerationLabel(
  eventId: string,
): Promise<{ verdict: string; reason: string } | null> {
  const events = await ndk.fetchEvents(
    { kinds: [1985], '#e': [eventId], '#L': [MODERATION_NAMESPACE] },
    { closeOnEose: true },
    localRelaySet,
  )
  if (events.size === 0) return null

  const latest = Array.from(events).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
  const verdict = latest.tags.find((t) => t[0] === 'l')?.[1]
  if (!verdict) return null
  return { verdict, reason: latest.content }
}
