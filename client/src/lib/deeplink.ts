import { NDKRelaySet, nip19 } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet, localRelayUrl, publicRelayUrls } from './ndk'
import { makeRelayConnectionFilter } from './relayFilter'
import { resolveNoteReference } from './resolvePubkey'
import { viewArticle, viewNote, viewGroup, viewJobOffer } from './navigation'
import { KIND_JOB_OFFER } from './job'

const isAllowedRelayUrl = makeRelayConnectionFilter(localRelayUrl)

// Resolves a `?nostr=<naddr1...>` deep link on load into a real in-app
// navigation — the client half of the kind:31990 NIP-89 handler
// announcement's `web` redirect tag (server/cmd/dvm/main.go publishes the
// server side). Without this, that announcement would advertise a URL
// another Nostr client could send a user to for "open this article in
// NOSTRAS" that didn't actually go anywhere once they arrived.
//
// naddr/kind:30023 and note/nevent are both handled now — a plain nevent
// used to be deliberately left alone ("NOSTRAS has no dedicated
// single-note view to redirect a plain nevent to, so that case is
// deliberately left alone rather than redirecting somewhere misleading")
// until SearchView.tsx's own note/nevent resolution (2026-08-10) gave it
// somewhere real to go — see lib/navigation.ts's viewNote.
//
// Groups use a separate `?group=<id>` param rather than being folded into
// `?nostr=`, deliberately: NIP-29 has no ratified bech32 entity for a
// group the way NIP-19 has naddr/nevent for articles/notes, and this
// app's own groups only ever live on one relay (NOSTRAS's own — see
// useGroupList's localRelaySet scoping), so the plain opaque group id
// (already just a crypto.randomUUID() string, see lib/groups.ts) is both
// sufficient and more honest than inventing a fake standards-shaped
// encoding for something that isn't actually interoperable with other
// clients the way the NIP-89 article handler link is.
export async function resolveDeepLinkFromUrl(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search)
  const groupId = params.get('group')
  if (groupId) {
    viewGroup(groupId)
    return true
  }

  const raw = params.get('nostr')
  if (!raw) return false

  try {
    const noteRef = resolveNoteReference(raw)
    if (noteRef) {
      const hintUrls = noteRef.relays.filter(isAllowedRelayUrl)
      const relaySet = NDKRelaySet.fromRelayUrls(
        Array.from(new Set([localRelayUrl, ...publicRelayUrls, ...hintUrls])),
        ndk,
      )
      const event = await ndk.fetchEvent({ ids: [noteRef.id] }, undefined, relaySet)
      if (event) {
        viewNote(event)
        return true
      }
      return false
    }

    const decoded = nip19.decode(raw)
    if (decoded.type === 'naddr' && decoded.data.kind === 30023) {
      // Explicitly scoped to localRelaySet (NOSTRAS's own relay) rather
      // than left to NDK's default relay selection. Real bug found while
      // verifying this against production, not a hypothetical: an
      // authors-filtered query with no explicit relaySet can trigger
      // NDK's own client-side outbox-relay resolution, which for an
      // author with no discoverable NIP-65 list returns nothing —
      // silently, no thrown error — even though the event was sitting
      // right there on nostras.app the whole time. Scoping to the app's
      // own relay sidesteps that entirely, and loses nothing real: the
      // server's own outbox aggregation (server/outbox.go) already
      // fans out to the true author's write relays for any
      // authors-filtered query the relay receives, so this still finds
      // articles the app's relay hasn't cached yet, just via a path
      // already proven correct elsewhere in this project instead of
      // NDK's less reliable client-side equivalent.
      const event = await ndk.fetchEvent(
        {
          kinds: [30023],
          authors: [decoded.data.pubkey],
          '#d': [decoded.data.identifier],
        },
        undefined,
        localRelaySet,
      )
      if (event) {
        viewArticle(event)
        return true
      }
    }

    // Same shape and same reasoning as the kind:30023 branch just
    // above (scoped to localRelaySet, not left to NDK's own outbox-relay
    // resolution) — job offers are addressable the same way articles
    // are, and this app's own job offers are always reachable via its
    // own relay regardless of which relay a link happens to be shared
    // through.
    if (decoded.type === 'naddr' && decoded.data.kind === KIND_JOB_OFFER) {
      const event = await ndk.fetchEvent(
        {
          kinds: [KIND_JOB_OFFER],
          authors: [decoded.data.pubkey],
          '#d': [decoded.data.identifier],
        },
        undefined,
        localRelaySet,
      )
      if (event) {
        viewJobOffer(event)
        return true
      }
    }
  } catch {
    // Malformed or unsupported entity in the URL — ignore, boot normally.
  }
  return false
}
