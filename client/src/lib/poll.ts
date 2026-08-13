import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, publicRelayUrls } from './ndk'

// NIP-88 kind:1068 poll / kind:1018 response. NDK's own kind catalog
// doesn't include either — same gap already hit for several other
// project-specific kinds this session.
export const KIND_POLL = 1068
export const KIND_POLL_RESPONSE = 1018

const PUBLISH_TIMEOUT_MS = 8000

export type PollOption = { id: string; label: string }

export type PollMeta = {
  question: string
  options: PollOption[]
  polltype: 'singlechoice' | 'multiplechoice'
  endsAt: number | null
}

export function parsePollMeta(event: NDKEvent): PollMeta {
  const options: PollOption[] = event.tags
    .filter((t) => t[0] === 'option' && t[1] && t[2])
    .map((t) => ({ id: t[1], label: t[2] }))
  const polltype = event.tags.find((t) => t[0] === 'polltype')?.[1]
  const endsAtTag = event.tags.find((t) => t[0] === 'endsAt')?.[1]
  return {
    question: event.content,
    options,
    polltype: polltype === 'multiplechoice' ? 'multiplechoice' : 'singlechoice',
    endsAt: endsAtTag ? Number(endsAtTag) : null,
  }
}

export function isPollEnded(meta: PollMeta): boolean {
  return meta.endsAt !== null && meta.endsAt <= Math.floor(Date.now() / 1000)
}

// A small dedicated formatter for a *future* timestamp, deliberately not
// reused from lib/time.ts's formatRelativeTime — that helper only ever
// handles past timestamps (every existing call site passes a note's own
// created_at) and returns "now" for any future value, which would be
// silently wrong here ("Ends now" for a poll actually ending in 2 hours).
export function formatEndsIn(endsAt: number): string {
  const diff = endsAt - Math.floor(Date.now() / 1000)
  if (diff <= 0) return 'now'
  if (diff < 3600) return `${Math.ceil(diff / 60)}m`
  if (diff < 86400) return `${Math.ceil(diff / 3600)}h`
  return `${Math.ceil(diff / 86400)}d`
}

// Per NIP-88, option ids just need to be unique within the poll, not
// globally meaningful — a short random string is enough.
export function makeOptionId(): string {
  return Math.random().toString(36).slice(2, 11)
}

export async function publishPoll(
  question: string,
  options: string[],
  polltype: 'singlechoice' | 'multiplechoice',
  endsInSeconds: number,
): Promise<void> {
  const tags: string[][] = options.map((label) => ['option', makeOptionId(), label])
  tags.push(['polltype', polltype])
  tags.push(['endsAt', String(Math.floor(Date.now() / 1000) + endsInSeconds)])
  // Required by NIP-88 ("relay: one or more relay URLs where responses
  // should be published") — same publicRelayUrls convention already
  // used for the zap goal "relays" tag. Read-side (usePollVotes) still
  // just subscribes against the normal connected pool rather than
  // scoping to exactly these URLs, matching useZapList's own precedent
  // for the analogous zap-goal "relays" tag.
  for (const url of publicRelayUrls) tags.push(['relay', url])

  const event = new NDKEvent(ndk, { kind: KIND_POLL, content: question, tags })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
}

export async function publishVote(pollEvent: NDKEvent, optionIds: string[]): Promise<void> {
  const tags: string[][] = [['e', pollEvent.id]]
  for (const id of optionIds) tags.push(['response', id])

  const event = new NDKEvent(ndk, { kind: KIND_POLL_RESPONSE, content: '', tags })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
}
