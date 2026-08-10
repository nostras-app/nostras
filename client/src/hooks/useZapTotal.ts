import { useEffect, useState } from 'react'
import { zapInvoiceFromEvent } from '@nostr-dev-kit/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

export type ZapListEntry = { id: string; pubkey: string; amountSats: number }

// Every kind:9735 zap receipt tagging this event, individually — not
// deduped/merged per sender, unlike useReactionList's like/repost
// handling. A like is a boolean; a zap has a real amount attached, and
// someone zapping the same note more than once (a real, meaningful thing
// to do) should show as separate contributions, not silently collapsed
// into one. zapInvoiceFromEvent (NDK's own NIP-57 parser) is what
// actually resolves the real sender — event.pubkey on a 9735 is the
// *zapper service's* key, not the person who paid.
export function useZapList(eventId: string): { total: number; zaps: ZapListEntry[] } {
  const [zaps, setZaps] = useState<ZapListEntry[]>([])

  useEffect(() => {
    setZaps([])
    const seen = new Set<string>()
    const sub = ndk.subscribe({ kinds: [9735], '#e': [eventId] })

    sub.on('event', (event: NDKEvent) => {
      if (seen.has(event.id)) return
      seen.add(event.id)
      const invoice = zapInvoiceFromEvent(event)
      if (!invoice) return
      const entry: ZapListEntry = {
        id: event.id,
        pubkey: invoice.zappee,
        amountSats: invoice.amount / 1000,
      }
      setZaps((prev) => [...prev, entry].sort((a, b) => b.amountSats - a.amountSats))
    })

    return () => sub.stop()
  }, [eventId])

  const total = zaps.reduce((sum, z) => sum + z.amountSats, 0)
  return { total, zaps }
}
