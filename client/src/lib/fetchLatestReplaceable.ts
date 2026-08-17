import type { NDKEvent, NDKFilter, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { ndk } from './ndk'

// Deliberately bypasses ndk.fetchEvent()/fetchEvents() entirely, even
// though both already accept an explicit relaySet — confirmed by reading
// NDK's own source that both hardcode closeOnEose: true internally
// (`{...opts, closeOnEose: true}`, with closeOnEose applied *after* the
// spread, so a caller can't override it). That means both convenience
// methods resolve as soon as NDKSubscription's own EOSE-convergence
// heuristic decides "enough" relays have answered — roughly a majority
// of whichever relays in the set happened to already be CONNECTED,
// checked live against `pool.connectedRelays()` — not once every relay
// in the set has actually responded.
//
// For a REPLACEABLE event where different relays can genuinely hold
// different-aged copies (a follow list republished more recently on one
// relay than another), this early exit is exactly the mechanism already
// found responsible for this project's own repeated "stale relay copy
// wins" bug — see the dated incident comments in useFollowing.ts and
// useFollowCounts.ts, both scoped to authorQueryRelaySet once already to
// reduce this, and both still able to converge on a slower-but-genuinely-
// newer relay's copy losing to a faster-but-stale one. Real, reported
// again 2026-08-17: a real profile's own Following count showed 592 on
// one device and 3 on another for the exact same identity's single real
// kind:3 event — the "3" side had converged early on a relay holding a
// much older copy before the relay with the current 592-entry list ever
// got to answer.
//
// This always waits the full timeout instead of trusting that heuristic,
// tracking whichever event has the highest created_at seen across the
// whole window — a deliberate speed-for-correctness tradeoff, reasonable
// for a one-shot fetch (not a hot path) on data where showing the wrong
// answer is worse than taking a few extra seconds to show the right one.
export function fetchLatestReplaceableEvent(
  filter: NDKFilter,
  relaySet: NDKRelaySet,
  timeoutMs = 5000,
): Promise<NDKEvent | null> {
  return new Promise((resolve) => {
    let newest: NDKEvent | null = null
    let settled = false

    const sub = ndk.subscribe(filter, { relaySet, closeOnEose: false })

    const finish = () => {
      if (settled) return
      settled = true
      sub.stop()
      resolve(newest)
    }

    sub.on('event', (event: NDKEvent) => {
      if (!newest || (event.created_at ?? 0) > (newest.created_at ?? 0)) {
        newest = event
      }
    })

    setTimeout(finish, timeoutMs)
  })
}
