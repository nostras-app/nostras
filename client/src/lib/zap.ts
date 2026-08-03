import {
  generateZapRequest,
  getNip57ZapSpecFromLud,
  NDKZapper,
} from '@nostr-dev-kit/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, publicRelayUrls } from './ndk'

// Builds a NIP-57 zap request and fetches a payable bolt11 invoice from the
// recipient's LNURL-pay endpoint. This only performs HTTP GETs to resolve
// the invoice — no funds move until the returned invoice is actually paid.
export async function createZapInvoice(
  target: NDKEvent,
  amountSats: number,
  comment?: string,
): Promise<string> {
  const profile = await target.author.fetchProfile()
  const lud16 = profile?.lud16
  const lud06 = profile?.lud06
  if (!lud16 && !lud06) {
    throw new Error('Recipient has no Lightning address (lud16/lud06) set')
  }

  const lnUrlData = await getNip57ZapSpecFromLud({ lud16, lud06 }, ndk)
  if (!lnUrlData) {
    throw new Error('Could not resolve a Lightning address for this user')
  }

  const amountMsat = amountSats * 1000
  const zapRequest = await generateZapRequest(
    target,
    ndk,
    lnUrlData,
    target.pubkey,
    amountMsat,
    publicRelayUrls,
    comment,
  )
  if (!zapRequest) {
    throw new Error('Failed to build zap request')
  }

  const zapper = new NDKZapper(target, amountMsat, 'msat')
  const invoice = await zapper.getLnInvoice(zapRequest, amountMsat, lnUrlData)
  if (!invoice) {
    throw new Error('Failed to fetch an invoice from the recipient')
  }
  return invoice
}
