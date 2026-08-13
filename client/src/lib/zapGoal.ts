import type { NDKEvent } from '@nostr-dev-kit/ndk'

// NIP-75 kind:9041 zap goal metadata lives in tags; content is the
// human-readable description (the spec's own wording — a separate
// "summary" tag also exists but would just duplicate content for this
// app's own compose flow, so it's not written; still read here in case
// another client's goal event used it instead of content).
export type ZapGoalMeta = {
  amountSats: number
  image: string | null
  description: string
}

export function parseZapGoalMeta(event: NDKEvent): ZapGoalMeta {
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1] ?? null
  const amountMsat = Number(tag('amount') ?? 0)
  return {
    amountSats: Math.round(amountMsat / 1000),
    image: tag('image'),
    description: event.content || tag('summary') || 'Zap goal',
  }
}
