import { NDKEvent, type NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, authorQueryRelaySet, localRelaySet } from './ndk'
import { fetchLatestReplaceableEvent } from './fetchLatestReplaceable'
import { withTimeout } from './podcast'
import { requestDvmJob, type DvmJobUpdate } from './dvm'

// NIP-99 classified listings. NDK's own kind catalog doesn't include
// either — same gap already hit for every other project-specific kind
// this app has added (poll, forum thread, podcast episode, zap goal).
export const KIND_LISTING = 30402 as NDKKind
export const KIND_LISTING_DRAFT = 30403 as NDKKind

// Marketplace "Buy Now" purchase confirmation — the client half of the
// server/cmd/dvm/main.go job kind of the same name. Not cast to NDKKind
// since these are only ever used as plain numbers in requestDvmJob's
// options, never in an NDK subscription filter.
export const KIND_JOB_REQUEST_LISTING_PURCHASE = 5907
export const KIND_JOB_RESULT_LISTING_PURCHASE = 6907

const PUBLISH_TIMEOUT_MS = 8000
const FETCH_TIMEOUT_MS = 8000

export type ListingImage = { url: string; width?: number; height?: number }

export type ListingMeta = {
  title: string
  description: string
  priceAmount: string
  priceCurrency: string
  priceFrequency: string | null
  location: string
  categories: string[]
  images: ListingImage[]
  status: 'active' | 'sold'
  publishedAt: number | null
}

function parseImageTag(tag: string[]): ListingImage {
  const [, url, dims] = tag
  if (!dims) return { url }
  const [width, height] = dims.split('x').map(Number)
  return Number.isFinite(width) && Number.isFinite(height) ? { url, width, height } : { url }
}

export function parseListingMeta(event: NDKEvent): ListingMeta {
  const tag = (name: string) => event.tags.find((t) => t[0] === name)
  const priceTag = tag('price')
  const publishedAtTag = tag('published_at')?.[1]
  return {
    title: tag('title')?.[1] ?? '',
    description: event.content,
    priceAmount: priceTag?.[1] ?? '',
    priceCurrency: priceTag?.[2] ?? '',
    priceFrequency: priceTag?.[3] ?? null,
    location: tag('location')?.[1] ?? '',
    categories: event.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]),
    images: event.tags.filter((t) => t[0] === 'image' && t[1]).map(parseImageTag),
    status: tag('status')?.[1] === 'sold' ? 'sold' : 'active',
    publishedAt: publishedAtTag ? Number(publishedAtTag) : null,
  }
}

export type PublishListingInput = {
  title: string
  description: string
  priceAmount: string
  priceCurrency: string
  priceFrequency?: string
  location?: string
  categories: string[]
  images: ListingImage[]
}

export async function publishListing(input: PublishListingInput): Promise<NDKEvent> {
  const priceTag = ['price', input.priceAmount.trim(), input.priceCurrency.trim()]
  if (input.priceFrequency?.trim()) priceTag.push(input.priceFrequency.trim())

  const tags: string[][] = [
    ['d', crypto.randomUUID()],
    ['title', input.title.trim()],
    priceTag,
    ['published_at', String(Math.floor(Date.now() / 1000))],
  ]
  if (input.location?.trim()) tags.push(['location', input.location.trim()])
  for (const category of input.categories) {
    if (category.trim()) tags.push(['t', category.trim()])
  }
  for (const image of input.images) {
    tags.push(
      image.width && image.height
        ? ['image', image.url, `${image.width}x${image.height}`]
        : ['image', image.url],
    )
  }

  const event = new NDKEvent(ndk, { kind: KIND_LISTING, content: input.description.trim(), tags })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
  return event
}

// Owner-only edit — currently just the "Mark as sold" action, but shaped
// to carry any future field edit too. Fetches the *current* copy first
// (fetchLatestReplaceableEvent, not a plain ndk.fetchEvent() — same
// closeOnEose race this project has already found and fixed repeatedly
// for other replaceable kinds) rather than trusting whatever copy the
// caller already has in memory, since a concurrent edit from another of
// the owner's own sessions is a real, if narrow, possibility. Preserves
// every tag this function doesn't explicitly touch — same "spread, don't
// replace wholesale" discipline as every other fetch-then-merge hook in
// this app.
export async function publishListingStatusUpdate(
  event: NDKEvent,
  status: 'active' | 'sold',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
  if (!dTag) return { ok: false, error: 'This listing has no d tag — cannot edit it' }

  const current = await withTimeout(
    fetchLatestReplaceableEvent(
      { kinds: [KIND_LISTING], authors: [event.pubkey], '#d': [dTag] },
      authorQueryRelaySet,
    ),
    FETCH_TIMEOUT_MS,
    'Timed out fetching the current listing',
  ).catch(() => null)

  const base = current ?? event
  const tags = base.tags.filter((t) => t[0] !== 'status')
  tags.push(['status', status])

  try {
    const updated = new NDKEvent(ndk, { kind: KIND_LISTING, content: base.content, tags })
    await updated.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to update listing' }
  }
}

// Thin wrapper around the generic requestDvmJob(), same shape as
// requestGroupJoin (lib/communities.ts) — scoped to localRelaySet since
// this job only makes sense against NOSTRAS's own DVM, not the wider
// public-relay publish set every ordinary note uses.
export function requestListingPurchase(
  listingId: string,
  onUpdate: (update: DvmJobUpdate) => void,
): () => void {
  return requestDvmJob({
    requestKind: KIND_JOB_REQUEST_LISTING_PURCHASE,
    resultKind: KIND_JOB_RESULT_LISTING_PURCHASE,
    inputText: listingId,
    onUpdate,
    relaySet: localRelaySet,
  })
}
