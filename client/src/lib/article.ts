import type { NDKEvent } from '@nostr-dev-kit/ndk'

// NIP-23 long-form content (kind 30023) metadata lives in tags, not
// content (content is the markdown body itself).
export type ArticleMeta = {
  title: string
  summary: string | null
  image: string | null
  publishedAt: number | null
}

export function parseArticleMeta(event: NDKEvent): ArticleMeta {
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1] ?? null
  const publishedAtRaw = tag('published_at')
  return {
    title: tag('title') || 'Untitled',
    summary: tag('summary'),
    image: tag('image'),
    publishedAt: publishedAtRaw ? Number(publishedAtRaw) : null,
  }
}
