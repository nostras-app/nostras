import { useEffect, useState } from 'react'
import { zapInvoiceFromEvent } from '@nostr-dev-kit/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

// Sum of kind:9735 zap receipts tagging this event, in sats.
export function useZapTotal(eventId: string): number {
  const [totalSats, setTotalSats] = useState(0)

  useEffect(() => {
    setTotalSats(0)
    const seen = new Set<string>()
    let total = 0
    const sub = ndk.subscribe({ kinds: [9735], '#e': [eventId] })

    sub.on('event', (event: NDKEvent) => {
      if (seen.has(event.id)) return
      seen.add(event.id)
      const invoice = zapInvoiceFromEvent(event)
      if (!invoice) return
      total += invoice.amount / 1000
      setTotalSats(total)
    })

    return () => sub.stop()
  }, [eventId])

  return totalSats
}
