import { NDKEvent, type NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, authorQueryRelaySet } from './ndk'
import { encryptArticleBody } from './paidArticles'
import { fetchLatestReplaceableEvent } from './fetchLatestReplaceable'

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

// Ditto (and other podstr-convention clients) render podcast episodes
// via kind:30054 — an addressable event (30000-39999 range), a
// completely different, incompatible convention from NIP-F4's kind:54
// above. Confirmed directly against Ditto's own real, live source, not
// assumed from docs alone: PodcastsFeedPage.tsx queries
// `kind={[30054, 30055]}`, never kind 54, which is why a real published
// NOSTRAS episode (2026-09-04) never appeared in Ditto's Podcasts tab
// at all. Tag shape below follows derekross/podstr's NIP.md draft
// (the spec Ditto's own kindLabels.ts/podcastHelpers.ts trace back to),
// cross-checked against Ditto's actual parsePodcastEpisode() parser to
// confirm the two agree rather than trusting the doc alone — that
// parser is deliberately lenient (falls back through several tag names
// for most fields), but still requires a real, plaintext, resolvable
// audio URL to return non-null at all.
//
// Publishing this second, separate event is purely additive — it
// doesn't touch or replace the kind:54/10154 publish above, which stays
// this app's own primary, load-bearing format. Deliberately best-effort
// (see publishDittoCompatEpisode's own caller): a failure here is
// caught and logged, never thrown, so a Ditto-compatibility hiccup can
// never break the publish flow the composer already depends on.
//
// Scoped to free (non-paid) episodes only. A DVM-gated paid episode's
// real audio URL only ever exists as ciphertext this app's own paid-
// unlock flow can decrypt — Ditto has no way to pay/unlock that, so a
// kind:30054 copy with no resolvable audio would just silently fail
// Ditto's own parser (which requires a real URL to return non-null) —
// not harmful, but pointless, so skipped outright rather than
// publishing a dead event.
//
// `duration` is deliberately left out even though the spec allows it:
// NOSTRAS's own compose flow has no field to capture episode duration
// today, and computing it client-side (decoding the uploaded audio)
// is new, separate scope beyond "publish both kinds" — a real, known
// gap, not silently pretended away. Same for the optional `t` topic
// tags (no topic-tagging UI exists in this composer) and for kind:30055
// trailers / kind:30078 podcast-metadata (NOSTRAS has no "trailer"
// concept, and Ditto's own PodcastsFeedPage renders individual episodes
// standalone with no dependency on show-level 30078 metadata — that
// kind only matters for RSS-bridge-style aggregators, not for showing
// up in Ditto's feed, which is the actual goal here).
export const KIND_PODCAST_EPISODE_DITTO = 30054 as NDKKind

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

  // See KIND_PODCAST_EPISODE_DITTO's own doc comment for why this is
  // scoped to free episodes only, best-effort, and never allowed to
  // affect the primary publish above (already succeeded by this point).
  if (!input.paid) {
    try {
      await publishDittoCompatEpisode({
        title: input.title,
        image: input.image,
        description: input.description,
        audioUrl: input.audioUrl,
        audioType: input.audioType,
      })
    } catch (err) {
      console.warn(
        'Ditto-compatible (kind 30054) episode publish failed — the primary episode still published fine:',
        err,
      )
    }
  }
}

async function publishDittoCompatEpisode(input: {
  title: string
  image: string
  description: string
  audioUrl: string
  audioType: string
}): Promise<void> {
  const title = input.title.trim()
  const description = input.description.trim()

  const tags: string[][] = [
    ['d', crypto.randomUUID()],
    ['title', title],
    input.audioType ? ['audio', input.audioUrl, input.audioType] : ['audio', input.audioUrl],
    // RFC2822, matching new Date().toUTCString()'s exact format — the
    // spec's own required shape, and one of the two forms Ditto's own
    // parser (parsePodcastEpisode) explicitly accepts for `pubdate`.
    ['pubdate', new Date().toUTCString()],
    // NIP-31 alt tag, required per the podstr spec this kind traces to —
    // a plain human-readable fallback for any client that doesn't know
    // what a kind:30054 event is.
    ['alt', `Podcast episode: ${title}`],
  ]
  if (description) tags.push(['description', description])
  if (input.image.trim()) tags.push(['image', input.image.trim()])

  const event = new NDKEvent(ndk, {
    kind: KIND_PODCAST_EPISODE_DITTO,
    content: description,
    tags,
  })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
}

export async function fetchShowMetaTags(pubkey: string): Promise<string[][] | null> {
  try {
    // fetchLatestReplaceableEvent, not plain ndk.fetchEvent(), as of
    // 2026-08-17 — even authorQueryRelaySet-scoped, fetchEvent()
    // hardcodes closeOnEose:true and can converge on a stale relay's
    // copy of this replaceable kind:10154 before a slower relay's
    // fresher one arrives — same race found and fixed for
    // useFollowing.ts/useFollowCounts.ts, see that dated CLAUDE.md
    // entry.
    const event = await withTimeout(
      fetchLatestReplaceableEvent({ kinds: [KIND_PODCAST_METADATA], authors: [pubkey] }, authorQueryRelaySet),
      FETCH_TIMEOUT_MS,
      'Timed out fetching show info',
    )
    return event?.tags ?? null
  } catch {
    return null
  }
}
