import {
  generateZapRequest,
  getNip57ZapSpecFromLud,
  NDKZapper,
} from '@nostr-dev-kit/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, authorQueryRelaySet, publicRelayUrls } from './ndk'

// Real, live bug caught in production, not hypothetical: this whole chain
// (a profile fetch, then two real external HTTP calls — the recipient's
// LNURL-pay metadata endpoint, then its invoice callback) had no timeout
// anywhere, so a single slow/unresponsive third-party Lightning service
// left the zap button stuck on "Fetching…" indefinitely with no way to
// know if it would ever resolve. Same missing-timeout class already fixed
// in blossom.ts/remoteSigner.ts/dm.ts/appData.ts/paidArticles.ts, just
// never applied here. One overall wrap rather than per-call, matching this
// codebase's own precedent for a multi-step async chain (paidArticles.ts).
const ZAP_INVOICE_TIMEOUT_MS = 20000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
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

// Builds a NIP-57 zap request and fetches a payable bolt11 invoice from the
// recipient's LNURL-pay endpoint. This only performs HTTP GETs to resolve
// the invoice — no funds move until the returned invoice is actually paid.
export async function createZapInvoice(
  target: NDKEvent,
  amountSats: number,
  comment?: string,
): Promise<string> {
  return withTimeout(
    createZapInvoiceInner(target, amountSats, comment),
    ZAP_INVOICE_TIMEOUT_MS,
    'Timed out fetching an invoice — the recipient\'s Lightning service may be unreachable',
  )
}

async function createZapInvoiceInner(
  target: NDKEvent,
  amountSats: number,
  comment?: string,
): Promise<string> {
  // Real bug class already fixed once for useProfile.ts (2026-08-10):
  // NDKUser.fetchProfile() internally does an unscoped ndk.fetchEvent
  // with no relay set unless one is explicitly passed via opts — this
  // call site never had that fix applied.
  const profile = await target.author.fetchProfile({ relaySet: authorQueryRelaySet })
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
