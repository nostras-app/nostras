import { NDKEvent, type NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from './ndk'

// Same explicit-timeout convention as every other publish path in this
// app (Composer.tsx, useFollowing.ts, etc.) — NDKEvent.publish()'s
// default 2.5s per-relay timeout is tight under real relay load.
const PUBLISH_TIMEOUT_MS = 8000

// Not in NDK's own kind catalog — same gap already hit for NIP-29's
// delete kinds, the paid-article-unlock result kind, and NIP-38/39's
// own kinds.
export const KIND_COMMENT = 1111 as NDKKind

// Addressable (parameterized-replaceable) kinds live in 30000-39999 per
// NIP-01 — a NIP-23 article is one; a NIP-7D forum thread (kind 11) is
// not. NIP-22 roots that aren't addressable use E/e (event id) instead
// of A/a (address) — this matters for real interop, not just NOSTRAS's
// own reader: an addressable root can be edited/republished under the
// same address, so pointing at the address (not one specific event id)
// is what keeps a comment attached to "the article," not one revision
// of it, while a regular event has no such concept and is identified by
// its id alone.
export function isAddressableKind(kind: number | undefined): boolean {
  return kind !== undefined && kind >= 30000 && kind < 40000
}

// NIP-22 top-level comment on a root item (a NIP-23 article or a NIP-7D
// forum thread, this app's two current uses). Root scope (E/A/I, K, P —
// uppercase) and parent scope (e/a/i, k, p — lowercase) are identical
// here: this is deliberately scoped to top-level comments only, not
// replies to another comment, matching this app's existing "one level
// of thread depth, not a full nested tree" precedent (SingleNoteView's
// own reply view) — and NIP-7D's own explicit guidance for threads
// specifically ("Replies should always be to the root kind 11 to avoid
// arbitrarily nested reply hierarchies"). A reply-to-a-comment UI would
// need real parent-vs-root tag divergence and a threaded renderer — a
// genuinely separate, bigger feature, not built here.
export async function publishComment(rootEvent: NDKEvent, content: string): Promise<void> {
  const kind = String(rootEvent.kind)
  const tags: string[][] = isAddressableKind(rootEvent.kind)
    ? [
        ['A', rootEvent.tagAddress()],
        ['K', kind],
        ['P', rootEvent.pubkey],
        ['a', rootEvent.tagAddress()],
        ['k', kind],
        ['p', rootEvent.pubkey],
      ]
    : [
        ['E', rootEvent.id, '', rootEvent.pubkey],
        ['K', kind],
        ['P', rootEvent.pubkey],
        ['e', rootEvent.id, '', rootEvent.pubkey],
        ['k', kind],
        ['p', rootEvent.pubkey],
      ]

  const event = new NDKEvent(ndk, { kind: KIND_COMMENT, content, tags })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
}
