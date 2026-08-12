import type { NDKEvent } from '@nostr-dev-kit/ndk'

// NIP-23 long-form content (kind 30023) metadata lives in tags, not
// content (content is the markdown body itself).
export type ArticleMeta = {
  title: string
  summary: string | null
  image: string | null
  publishedAt: number | null
  // Paid articles (see lib/paidArticles.ts): `encrypted` is a plain
  // presence check (the `["encrypted"]` marker tag is deliberately
  // single-element, matching NIP-90's own convention — see the
  // server-side hasTag() comment on why a naive .find()-style lookup
  // requiring 2+ elements would silently miss it). `priceSats` is
  // author-set at publish time, read directly off the event, not
  // computed.
  encrypted: boolean
  priceSats: number | null
}

export function parseArticleMeta(event: NDKEvent): ArticleMeta {
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1] ?? null
  const publishedAtRaw = tag('published_at')
  const priceRaw = tag('price')
  return {
    title: tag('title') || 'Untitled',
    summary: tag('summary'),
    image: tag('image'),
    publishedAt: publishedAtRaw ? Number(publishedAtRaw) : null,
    encrypted: event.tags.some((t) => t[0] === 'encrypted'),
    priceSats: priceRaw ? Number(priceRaw) : null,
  }
}
