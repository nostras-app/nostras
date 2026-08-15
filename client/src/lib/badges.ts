import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from './ndk'

// NIP-58 Badges. NDK's own NDKKind.ProfileBadge = 30008 reflects an
// older draft of this NIP — re-fetching the live spec text directly
// (not assumed from NDK's naming) confirmed the current spec moved
// "Profile Badges" (a user's own opt-in, ordered display list) to a
// plain replaceable kind:10008, and repurposed 30008 for a different,
// newer concept ("Badge Set" — a named/ordered grouping of badges,
// deliberately not built in this pass). Same class of library-vs-
// current-spec drift already hit once for NIP-39 (kind:0 vs kind:10011)
// — trusting the current spec text over the library's constant name.
export const KIND_BADGE_DEFINITION = NDKKind.BadgeDefinition // 30009, matches current spec
export const KIND_BADGE_AWARD = NDKKind.BadgeAward // 8, matches current spec
export const KIND_PROFILE_BADGES = 10008 as NDKKind // NDK has no constant for this at all

const PUBLISH_TIMEOUT_MS = 8000

export type BadgeDefinition = {
  pubkey: string
  d: string
  address: string
  name: string
  description: string
  image: string
  thumb: string
}

export function badgeAddress(pubkey: string, d: string): string {
  return `${KIND_BADGE_DEFINITION}:${pubkey}:${d}`
}

export function parseBadgeAddress(address: string): { pubkey: string; d: string } | null {
  const parts = address.split(':')
  if (parts.length !== 3 || parts[0] !== String(KIND_BADGE_DEFINITION) || !parts[1] || !parts[2]) return null
  return { pubkey: parts[1], d: parts[2] }
}

export function parseBadgeDefinition(event: NDKEvent): BadgeDefinition {
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1] ?? ''
  const d = tag('d')
  return {
    pubkey: event.pubkey,
    d,
    address: badgeAddress(event.pubkey, d),
    name: tag('name'),
    description: tag('description'),
    image: tag('image'),
    thumb: tag('thumb'),
  }
}

// Thumb deliberately not exposed as a separate create-form field this
// pass (spec-optional, and the single `image` field already covers the
// common case) — a real scope choice, matching this project's own
// repeated "smallest useful slice" precedent, not an oversight.
export async function publishBadgeDefinition(d: string, name: string, description: string, image: string) {
  const tags: string[][] = [['d', d]]
  if (name) tags.push(['name', name])
  if (description) tags.push(['description', description])
  if (image) tags.push(['image', image])
  const event = new NDKEvent(ndk, { kind: KIND_BADGE_DEFINITION, tags, content: '' })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
  return event
}

export type BadgeAward = {
  id: string
  issuerPubkey: string
  address: string
  recipients: string[]
  createdAt: number
}

export function parseBadgeAward(event: NDKEvent): BadgeAward | null {
  const address = event.tags.find((t) => t[0] === 'a')?.[1]
  if (!address) return null
  const recipients = event.tags.filter((t) => t[0] === 'p' && !!t[1]).map((t) => t[1])
  return {
    id: event.id,
    issuerPubkey: event.pubkey,
    address,
    recipients,
    createdAt: event.created_at ?? 0,
  }
}

export async function publishBadgeAward(address: string, recipientPubkeys: string[]) {
  const tags: string[][] = [['a', address], ...recipientPubkeys.map((pk) => ['p', pk])]
  const event = new NDKEvent(ndk, { kind: KIND_BADGE_AWARD, tags, content: '' })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
  return event
}

export type ProfileBadgeEntry = { address: string; awardEventId: string }

// Walks a/e tag pairs per the spec's own consistency rule ("clients
// SHOULD ignore a without a corresponding e tag and vice versa") — only
// a strictly adjacent a,e pair produces an entry; anything else (a
// trailing lone `a`, an `e` with no preceding `a`) is dropped rather
// than guessed at.
export function parseProfileBadgeTags(tags: string[][]): ProfileBadgeEntry[] {
  const entries: ProfileBadgeEntry[] = []
  for (let i = 0; i < tags.length - 1; i++) {
    if (tags[i][0] === 'a' && tags[i + 1][0] === 'e' && tags[i][1] && tags[i + 1][1]) {
      entries.push({ address: tags[i][1], awardEventId: tags[i + 1][1] })
      i++
    }
  }
  return entries
}

export function buildProfileBadgeTags(entries: ProfileBadgeEntry[]): string[][] {
  return entries.flatMap((e) => [
    ['a', e.address],
    ['e', e.awardEventId],
  ])
}
