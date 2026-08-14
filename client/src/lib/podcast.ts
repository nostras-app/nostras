import { NDKEvent, type NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, authorQueryRelaySet } from './ndk'
import { encryptArticleBody } from './paidArticles'

// NIP-F4 Podcasting. Not in NDK's own kind catalog — same gap already
// hit for several other project-specific kinds this session.
//
// Scope, deliberately minimal for this pass (matching this project's
// own "smallest useful slice" precedent for every prior NIP): only
// kind:10154 (show metadata, replaceable — no "d" tag needed, it's in
// the 10000-19999 range not the 30000-39999 addressable range) and
// kind:54 (episodes) are implemented. Two more kinds the spec defines
// are deliberately deferred: kind:10064 ("Authored Podcasts," a list of
// shows a person hosts) and kind:10054 ("Favorite Podcasts," a
// listener's followed-shows list) — both real, both the same simple
// fetch-then-republish list shape already proven for bookmarks/follows/
// linked accounts, just not the core publish-and-listen loop this pass
// covers. A real spec ambiguity found while researching, worth
// remembering if either deferred kind ever gets built: the spec's own
// prose describes "Authored Podcasts" as kind 10164 in one place but its
// YAML frontmatter says 10064 — these disagree; the YAML value (the
// machine-readable source of truth) is the one to trust.
//
// "Show" = the publishing identity itself for v1 — there's no dedicated
// "create a show as its own sub-identity" wizard here. NIP-F4's own
// intent (a show as its own keypair, so co-hosting/portability doesn't
// depend on one person's identity) is still fully reachable today
// without any new code: this app's existing multi-identity support
// (Settings > Identities > Create new identity, then switch) already
// lets someone publish a show under a dedicated keypair if they want
// one, separate from their personal identity.
//
// Confirmed no kind-number collision with anything this project already
// implements or with go-nostr's/NDK's own kind catalogs before building
// this — the exact class of bug that made NIP-7D's kind:11 completely
// unpublishable until fixed at the relay level.
export const KIND_PODCAST_METADATA = 10154 as NDKKind
export const KIND_PODCAST_EPISODE = 54 as NDKKind

const PUBLISH_TIMEOUT_MS = 8000
const FETCH_TIMEOUT_MS = 8000

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export type ShowMeta = {
  title: string
  image: string
  description: string
  website: string
}

// Tag-array-based, matching this codebase's established convention
// (lib/subject.ts, lib/contentWarning.ts) rather than taking a whole
// NDKEvent — reusable both for a fetched event's tags and for a draft
// tag array mid-edit.
export function parseShowMeta(tags: string[][]): ShowMeta {
  return {
    title: tags.find((t) => t[0] === 'title')?.[1] ?? '',
    image: tags.find((t) => t[0] === 'image')?.[1] ?? '',
    description: tags.find((t) => t[0] === 'description')?.[1] ?? '',
    website: tags.find((t) => t[0] === 'website')?.[1] ?? '',
  }
}

export type EpisodeMeta = {
  title: string
  image: string
  description: string
  audioUrl: string
  audioType: string
  // DVM-gated paid episodes (2026-08-14): reuses the exact same
  // encrypted/price convention — and the exact same DVM job (kind
  // 5904->6904) — already proven for paid articles (lib/paidArticles.ts).
  // handleArticleUnlockJob on the server was already fully generic over
  // which event kind it unlocks (it only ever looks at `encrypted`/
  // `price` tags and the referenced event's own content/pubkey, never
  // its kind), so zero server changes were needed. What's encrypted here
  // is the audio URL itself (as a small JSON blob carrying type too, so
  // it survives the round trip), not the show notes — mirroring how a
  // paid article encrypts its body: only one "the real thing being sold"
  // slot exists per event, and for an episode that's the audio, not the
  // notes. A paid episode has no plaintext `audio` tag at all — the real
  // URL only ever exists inside the ciphertext.
  encrypted: boolean
  priceSats: number | null
}

export function parseEpisodeMeta(tags: string[][]): EpisodeMeta {
  const audioTag = tags.find((t) => t[0] === 'audio')
  const priceRaw = tags.find((t) => t[0] === 'price')?.[1] ?? null
  return {
    title: tags.find((t) => t[0] === 'title')?.[1] ?? 'Untitled episode',
    image: tags.find((t) => t[0] === 'image')?.[1] ?? '',
    description: tags.find((t) => t[0] === 'description')?.[1] ?? '',
    audioUrl: audioTag?.[1] ?? '',
    audioType: audioTag?.[2] ?? '',
    encrypted: tags.some((t) => t[0] === 'encrypted'),
    priceSats: priceRaw ? Number(priceRaw) : null,
  }
}

// Encrypted as one small JSON blob (not just the bare URL string) so the
// media type survives the round trip too — parsed back out by the reader
// side once requestArticleUnlock (reused as-is, see lib/paidArticles.ts —
// it's generic over which event id it unlocks despite the article-flavored
// name) returns the decrypted plaintext.
type EncryptedAudioPayload = { url: string; type: string }

export function parseEncryptedAudioPayload(plaintext: string): EncryptedAudioPayload {
  try {
    const parsed = JSON.parse(plaintext) as Partial<EncryptedAudioPayload>
    return { url: parsed.url ?? '', type: parsed.type ?? '' }
  } catch {
    return { url: '', type: '' }
  }
}

export async function publishEpisode(input: {
  title: string
  image: string
  description: string
  audioUrl: string
  audioType: string
  content: string
  // When set, requires a dvmPubkey too (fetched via
  // fetchDvmArticleEncryptionPubkey() at the call site, same as
  // ArticleComposer) — publishEpisode itself doesn't fetch it, so a
  // composer can surface "DVM not available" as its own error before
  // ever attempting to publish.
  paid?: { priceSats: number; dvmPubkey: string }
}): Promise<void> {
  const tags: string[][] = [['title', input.title.trim()]]
  if (input.image.trim()) tags.push(['image', input.image.trim()])
  if (input.description.trim()) tags.push(['description', input.description.trim()])

  let content = input.content

  if (input.paid) {
    const payload: EncryptedAudioPayload = { url: input.audioUrl, type: input.audioType }
    content = await encryptArticleBody(JSON.stringify(payload), input.paid.dvmPubkey)
    tags.push(['encrypted'])
    tags.push(['price', String(input.paid.priceSats)])
  } else {
    tags.push(
      input.audioType ? ['audio', input.audioUrl, input.audioType] : ['audio', input.audioUrl],
    )
  }

  const event = new NDKEvent(ndk, { kind: KIND_PODCAST_EPISODE, content, tags })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
}

export async function fetchShowMetaTags(pubkey: string): Promise<string[][] | null> {
  try {
    const event = await withTimeout(
      ndk.fetchEvent({ kinds: [KIND_PODCAST_METADATA], authors: [pubkey] }, undefined, authorQueryRelaySet),
      FETCH_TIMEOUT_MS,
      'Timed out fetching show info',
    )
    return event?.tags ?? null
  } catch {
    return null
  }
}
