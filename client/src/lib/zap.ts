import { NDKEvent as NDKEventClass, getNip57ZapSpecFromLud } from '@nostr-dev-kit/ndk'
import type { NDKEvent, NDKLnUrlData } from '@nostr-dev-kit/ndk'
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
  const zapRequest = await buildZapRequest(target, target.pubkey, amountMsat, lud16, lnUrlData.callback, comment)

  return fetchInvoiceFromCallback(zapRequest, amountMsat, lnUrlData)
}

// Real, live bug found and confirmed live in production, not hypothetical
// (2026-08-14): every zap through this app was building a malformed NIP-57
// zap request, and it only surfaced once a recipient's LNURL service (Alby,
// confirmed) happened to validate strictly enough to reject it. Traced by
// reproducing the failure myself against a live recipient with a throwaway
// identity, capturing the exact request via the console logging added just
// before this fix, then bisecting it tag-by-tag against the real recipient's
// real endpoint (safe — LNURL-pay invoice requests are plain GETs, no funds
// move until the returned invoice is actually paid) until the single element
// that broke it was isolated.
//
// Root cause: NDK's own generateZapRequest() calls target.referenceTags(),
// which — read directly in NDK's installed source — *unconditionally*
// appends an empty-string NIP-10 marker to the "e" tag when none is given:
// `tag.push(marker ?? "")`. The result is a 5-element tag
// (`["e", id, relayHint, "", targetPubkey]`) for literally every zap this
// app has ever sent to any event. A plain `["e", id]` or `["e", id,
// relayHint]` — both independently confirmed against the real recipient —
// work correctly; adding the empty marker element is what breaks it.
// generateZapRequest() also sets the "lnurl" tag to the *callback* URL
// (`data.callback`) rather than the actual LNURL-pay endpoint the spec
// describes — a separate, real deviation, fixed here too for lud16
// recipients (the common case) since it costs nothing once tags are being
// built by hand anyway; lud06-only recipients keep the callback URL, same
// as before, rather than pulling in a bech32 decoder for a rarer legacy
// format.
//
// Rather than patch NDK's vendored referenceTags() (a much larger, more
// actively-changing library than this project's own khatru/eventstore
// forks) or try to mutate its output after the fact (signatures cover the
// exact tag bytes — any post-sign mutation invalidates them, a mistake
// made and caught during this very investigation), the zap request is
// built and signed directly here, matching NIP-57's real minimum shape.
async function buildZapRequest(
  target: NDKEvent,
  pubkey: string,
  amountMsat: number,
  lud16: string | undefined,
  callbackUrl: string,
  comment?: string,
): Promise<NDKEvent> {
  // lud06-only recipients keep the callback URL here (matching this app's
  // pre-existing behavior) rather than pulling in a bech32 decoder just to
  // recover the true LNURL endpoint for a now-rare legacy format.
  const lnurlTagValue =
    lud16 && !lud16.startsWith('LNURL')
      ? `https://${lud16.split('@')[1]}/.well-known/lnurlp/${lud16.split('@')[0]}`
      : callbackUrl

  const tags: string[][] = [
    ['relays', ...publicRelayUrls.slice(0, 4)],
    ['amount', amountMsat.toString()],
    ...(lnurlTagValue ? [['lnurl', lnurlTagValue]] : []),
    ['p', pubkey],
    ['e', target.id],
    ...(target.kind !== undefined ? [['k', target.kind.toString()]] : []),
  ]

  const event = new NDKEventClass(ndk, { kind: 9734, content: comment || '', tags })
  await event.sign()
  return event
}

// Real, live bug reported by a real user (2026-08-14): zapping a real Zap
// Goal from a real device failed with the generic "Failed to fetch an
// invoice from the recipient" message, with no way to tell why. Traced to
// NDK's own NDKZapper.getLnInvoice() — it fetches the LNURL callback and,
// on a 200 response with no `pr` field, just returns `null`, discarding
// whatever the recipient's Lightning service actually said (many LNURL
// implementations respond 200 with `{status:"ERROR", reason:"..."}`
// instead of a non-200 status). A faithful replica of this exact request
// (same zap goal, same amount, same tag shape) against the real recipient's
// real LNURL provider was independently confirmed to succeed while
// investigating this, which rules out the amount/provider/zap-goal-shape
// as the general cause — but without the recipient's own `reason` text,
// any *future* occurrence of this same generic message is equally
// undiagnosable. This hand-rolls the same single fetch NDK's own
// getLnInvoice performs (same URL construction, same amount+nostr query
// params) so a non-200 or missing-`pr` response surfaces the recipient's
// own stated reason instead of a one-size-fits-all string. NDKZapper
// itself is no longer needed here now that its one call site (this
// function) is inlined — nothing else in this file used it.
async function fetchInvoiceFromCallback(
  zapRequest: NDKEvent,
  amountMsat: number,
  data: NDKLnUrlData,
): Promise<string> {
  const url = new URL(data.callback)
  url.searchParams.append('amount', amountMsat.toString())
  url.searchParams.append('nostr', JSON.stringify(zapRequest.rawEvent()))
  const response = await fetch(url.toString())
  if (response.status !== 200) {
    const text = await response.text()
    throw new Error(`Recipient's Lightning service rejected the request (${response.status}): ${text}`)
  }
  const body = await response.json()
  if (!body.pr) {
    const reason = body.reason || body.status || 'no invoice returned'
    // Real report (2026-08-14): a recipient's LNURL service rejected a real
    // zap request as malformed ("Invalid zap request"), on a device whose
    // signer was independently confirmed working (a like from the same
    // identity published fine) — so the failure is specific to this exact
    // request, not the signer. Logging the actual bytes sent is the only
    // way to compare a real failing request against a known-good one; the
    // event is about to be broadcast to a Lightning service regardless, so
    // there's nothing here that isn't already leaving the device.
    console.error('[zap] recipient rejected zap request', { reason, zapRequest: zapRequest.rawEvent(), callbackUrl: url.toString() })
    throw new Error(`Recipient's Lightning service did not return an invoice: ${reason}`)
  }
  return body.pr
}
