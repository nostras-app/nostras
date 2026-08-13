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

// NIP-22 top-level comment on a root item (a NIP-23 article, in this
// app's only current use). Root scope (E/A/I, K, P — uppercase) and
// parent scope (e/a/i, k, p — lowercase) are identical here: this is
// deliberately scoped to top-level article comments only, not replies
// to another comment, matching this app's existing "one level of
// thread depth, not a full nested tree" precedent (SingleNoteView's own
// reply view). A reply-to-a-comment UI would need real parent-vs-root
// tag divergence and a threaded renderer — a genuinely separate,
// bigger feature, not built here.
export async function publishComment(rootEvent: NDKEvent, content: string): Promise<void> {
  const address = rootEvent.tagAddress()
  const kind = String(rootEvent.kind)
  const tags: string[][] = [
    ['A', address],
    ['K', kind],
    ['P', rootEvent.pubkey],
    ['a', address],
    ['k', kind],
    ['p', rootEvent.pubkey],
  ]

  const event = new NDKEvent(ndk, { kind: KIND_COMMENT, content, tags })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
}
