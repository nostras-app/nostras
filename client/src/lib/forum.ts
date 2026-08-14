import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from './ndk'

// NIP-7D Forum Threads. Kind 11 already has a real NDK constant
// (NDKKind.Thread) and a full NDKThread convenience class — unlike the
// many project-specific kinds this session has had to cast by hand, this
// one's a foundational-enough NIP that NDK already models it.
export const KIND_FORUM_THREAD = NDKKind.Thread

// Same explicit-timeout convention as every other publish path in this
// app (Composer.tsx, ArticleComposer.tsx, ZapGoalComposer.tsx, etc.).
const PUBLISH_TIMEOUT_MS = 8000

export type ThreadMeta = {
  title: string
}

// Per the spec: "Threads SHOULD include a title" — a thread with no
// title tag at all falls back to a generic label rather than rendering
// blank, matching this app's own degrade-gracefully posture elsewhere
// (an untitled article, a goal with no image, etc.).
export function parseThreadMeta(event: NDKEvent): ThreadMeta {
  const title = event.tags.find((t) => t[0] === 'title')?.[1]
  return { title: title?.trim() || 'Untitled thread' }
}

// Replies to a thread are real kind:1111 NIP-22 comments, per NIP-7D's
// own requirement ("Replies to kind 11 MUST use NIP-22 kind 1111
// comments") — no separate reply mechanism here. lib/comments.ts already
// builds those correctly for a non-addressable root like this one.
export async function publishForumThread(title: string, content: string): Promise<void> {
  const event = new NDKEvent(ndk, {
    kind: KIND_FORUM_THREAD,
    content,
    tags: [['title', title]],
  })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
}
