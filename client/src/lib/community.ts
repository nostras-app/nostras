import { NDKEvent, NDKRelaySet, type NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, localRelayUrl } from './ndk'
import { makeRelayConnectionFilter } from './relayFilter'
import { CURATED_RELAYS } from './curatedRelays'

// NIP-72 Moderated Communities — a genuinely different feature from this
// app's existing NIP-29 "Communities" (real-time relay-enforced group
// chat, see groups.ts/CommunitiesView.tsx). Prompted directly by the user
// asking whether NOSTRAS's Communities could "integrate" with Amethyst's
// — checked Amethyst's own real source (vitorpamplona/amethyst) before
// building anything, not assumed from the spec alone. They're not
// interoperable with each other: NIP-72 is a moderated *content* feed
// (posts get approved into visibility, like a subreddit) that needs no
// special relay support at all, structurally unlike NIP-29's relay-
// enforced live chat. Named "Boards" in this app's own UI (not
// "Communities") specifically to avoid colliding with the existing,
// unrelated NIP-29 feature under the same word.
//
// Real, useful finding from reading Amethyst's actual source (not just
// the spec): a NIP-72 post IS a NIP-22 comment (kind:1111), scoped to
// the community's own kind:34550 address via A/a/P/p tags — exactly what
// lib/comments.ts's existing publishComment() already produces
// unmodified for any addressable root event (34550 is in the
// 30000-39999 addressable range, same as this app's own kind:30023
// articles). No new posting code was needed at all — only the community
// definition, discovery, and moderator-approval pieces are genuinely new.
export const KIND_COMMUNITY_DEFINITION = 34550 as NDKKind
export const KIND_COMMUNITY_POST_APPROVAL = 4550 as NDKKind
export const KIND_COMMUNITY_POST = 1111 as NDKKind

const PUBLISH_TIMEOUT_MS = 8000

// Unlike NIP-29 groups (deliberately scoped to localRelaySet — they need
// this app's own relay to enforce membership), NIP-72 has no relay-side
// requirement at all, and boards are meant to be discoverable the same
// way Amethyst's own users would find them — across the wider public
// network, not just NOSTRAS's own relay. Reuses the same 15-relay
// CURATED_RELAYS list already vetted for /engage and the rebroadcast
// picker, pre-filtered through makeRelayConnectionFilter before
// fromRelayUrls — this codebase's own standing rule, since
// NDKRelaySet.fromRelayUrls() constructs relay objects unconditionally
// and bypasses the pool-level filter otherwise.
//
// Same import.meta.env.PROD split as devPublishRelaySet (see ndk.ts's
// own comment on why): local/dev builds — including this project's own
// testing — stay local-only, so a board created while developing never
// broadcasts to the real public network. Production gets the full
// curated set, since a board only reachable on 1-2 relays would defeat
// the entire point of a feature whose only purpose is cross-client
// discovery.
const isAllowedRelay = makeRelayConnectionFilter(localRelayUrl)
export const boardsRelaySet = NDKRelaySet.fromRelayUrls(
  import.meta.env.PROD ? [localRelayUrl, ...CURATED_RELAYS.filter(isAllowedRelay)] : [localRelayUrl],
  ndk,
)

export type CommunityMeta = {
  name: string
  description: string
  image: string
  moderators: string[]
}

export function parseCommunityMeta(tags: string[][]): CommunityMeta {
  return {
    name: tags.find((t) => t[0] === 'name')?.[1] ?? 'Untitled board',
    description: tags.find((t) => t[0] === 'description')?.[1] ?? '',
    image: tags.find((t) => t[0] === 'image')?.[1] ?? '',
    // Real bug caught live during verification, not shipped: NIP-72's
    // own moderator tag shape is ["p", pubkey, relay-url, "moderator"] —
    // the marker is at index 3, after the (often-empty) relay-hint slot
    // at index 2. An earlier draft checked t[2] and silently matched
    // nothing, since t[2] is almost always "" — confirmed live via a
    // real create → post → approve round trip where the board's own
    // owner never showed up as a moderator despite publishing a
    // correctly-shaped tag.
    moderators: tags.filter((t) => t[0] === 'p' && t[3] === 'moderator').map((t) => t[1]),
  }
}

// Creating a board makes its own owner a moderator too — the spec itself
// doesn't require this (the owner's approval authority is implicit in
// NIP-72's own model), but Amethyst's real UI does it by default and
// it's the only sane default: a board with no moderator tag at all would
// have no one whose approvals a reader should trust per the spec's own
// "clients should prioritize approvals from designated moderators" rule.
// Returns the already-signed, already-published event directly — not
// just its d tag — so the caller can navigate straight to it without
// waiting for useCommunityList's own live subscription to round-trip
// the same event back from a relay. Real bug caught before shipping:
// an earlier draft tried to find the new board in that hook's list
// immediately after creating it, which raced the subscription and
// would fail on essentially every real attempt.
export async function publishCommunityDefinition(input: {
  name: string
  description: string
  image: string
}): Promise<NDKEvent> {
  const dTag = crypto.randomUUID()
  const owner = ndk.activeUser?.pubkey
  if (!owner) throw new Error('No active identity')

  const tags: string[][] = [['d', dTag], ['name', input.name.trim()]]
  if (input.description.trim()) tags.push(['description', input.description.trim()])
  if (input.image.trim()) tags.push(['image', input.image.trim()])
  tags.push(['p', owner, '', 'moderator'])

  const event = new NDKEvent(ndk, { kind: KIND_COMMUNITY_DEFINITION, content: '', tags })
  await event.publish(boardsRelaySet, PUBLISH_TIMEOUT_MS)
  return event
}

// Adds/removes moderators by republishing the board's own kind:34550
// definition — it's addressable (same d tag), so this genuinely replaces
// the prior version rather than creating a second board. Deliberately
// "spread, don't replace": only the p/moderator tags are touched, every
// other tag (d, name, description, image, and anything this client
// doesn't itself know about) is carried over from the current event
// untouched — the same data-preservation discipline already established
// for ProfileEditor's kind:0 saves and every other fetch-then-republish
// hook in this app, applied here even though there's no separate fetch
// step (the caller already has the current board event in hand).
export async function updateModerators(
  board: NDKEvent,
  moderators: string[],
): Promise<NDKEvent> {
  const nonModeratorTags = board.tags.filter((t) => !(t[0] === 'p' && t[3] === 'moderator'))
  const tags = [...nonModeratorTags, ...moderators.map((pubkey) => ['p', pubkey, '', 'moderator'])]
  const event = new NDKEvent(ndk, { kind: KIND_COMMUNITY_DEFINITION, content: board.content, tags })
  await event.publish(boardsRelaySet, PUBLISH_TIMEOUT_MS)
  return event
}

// Moderator approval (kind:4550) — the mechanism that gives a post real
// visibility per NIP-72's own model (this is genuinely client-side,
// unlike NIP-29's relay-enforced membership: any relay just stores the
// event, readers decide whose approvals to trust). Tag shape and
// content (the full approved post, JSON-stringified) confirmed directly
// against the real NIP-72 spec text, not assumed.
export async function publishPostApproval(
  post: NDKEvent,
  community: NDKEvent,
): Promise<void> {
  const tags: string[][] = [
    ['a', community.tagAddress()],
    ['e', post.id],
    ['p', post.pubkey],
    ['k', String(post.kind)],
  ]
  const event = new NDKEvent(ndk, {
    kind: KIND_COMMUNITY_POST_APPROVAL,
    content: JSON.stringify(post.rawEvent()),
    tags,
  })
  await event.publish(boardsRelaySet, PUBLISH_TIMEOUT_MS)
}
