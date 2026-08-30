import { NDKEvent, NDKPrivateKeySigner, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { ndk } from './ndk'

// Scoped per Nostr identity (2026-08-30, real bug fix): originally one
// global connection string regardless of which identity was active —
// switching identities in Settings left the previous identity's wallet
// showing as connected. Every read/write below resolves the current
// identity via ndk.activeUser?.pubkey internally (same rationale as
// arkWallet.ts's identical fix, see its own comment) so every existing
// caller elsewhere in the app (ZapButton, TranslateButton, NoteMenu,
// etc.) keeps working unchanged — they were already implicitly scoped
// to "whichever identity is currently paying," this just makes the
// storage actually match that.
const NWC_URI_KEY_PREFIX = 'nostras:nwc-uri'

function scopedNwcUriKey(pubkey: string): string {
  return `${NWC_URI_KEY_PREFIX}:${pubkey}`
}

// Runs at most once per page load, the first time any identity's saved
// URI is looked up — migrates the old single global connection forward
// to whichever identity happens to be active at that moment, the same
// best-effort heuristic identities.ts's own legacy-nsec migration and
// arkWallet.ts's own mnemonic migration both already use.
let nwcMigrated = false
function migrateLegacyNwcUriIfNeeded(pubkey: string) {
  if (nwcMigrated) return
  nwcMigrated = true
  if (localStorage.getItem(scopedNwcUriKey(pubkey))) return
  const legacy = localStorage.getItem(NWC_URI_KEY_PREFIX)
  if (!legacy) return
  localStorage.setItem(scopedNwcUriKey(pubkey), legacy)
  localStorage.removeItem(NWC_URI_KEY_PREFIX)
}

export interface NwcConnection {
  walletPubkey: string
  relay: string
  secret: string
}

export function parseNwcUri(uri: string): NwcConnection {
  const withoutScheme = uri.replace(/^nostr\+walletconnect:\/\//, '')
  const [walletPubkey, queryString = ''] = withoutScheme.split('?')
  const params = new URLSearchParams(queryString)
  const relay = params.get('relay')
  const secret = params.get('secret')
  if (!walletPubkey || !relay || !secret) {
    throw new Error('Invalid nostr+walletconnect:// URI')
  }
  return { walletPubkey, relay, secret }
}

export function saveNwcUri(uri: string) {
  const pubkey = ndk.activeUser?.pubkey
  if (!pubkey) return
  localStorage.setItem(scopedNwcUriKey(pubkey), uri)
}

export function getSavedNwcUri(): string | null {
  const pubkey = ndk.activeUser?.pubkey
  if (!pubkey) return null
  migrateLegacyNwcUriIfNeeded(pubkey)
  return localStorage.getItem(scopedNwcUriKey(pubkey))
}

export function clearNwcUri() {
  const pubkey = ndk.activeUser?.pubkey
  if (!pubkey) return
  localStorage.removeItem(scopedNwcUriKey(pubkey))
}

// Shared NIP-47 request/response transport — used for both the mutating
// pay_invoice call and read-only queries like get_balance. The safety rule
// (must only run from an explicit user click) applies to *which* method a
// caller sends, not to this transport itself: get_balance moves no funds
// and is safe to call automatically (e.g. on profile load).
async function sendNwcRequest(
  uri: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const conn = parseNwcUri(uri)
  const clientSigner = new NDKPrivateKeySigner(conn.secret)
  const walletUser = ndk.getUser({ pubkey: conn.walletPubkey })
  const relaySet = NDKRelaySet.fromRelayUrls([conn.relay], ndk)

  const encryptedContent = await clientSigner.encrypt(
    walletUser,
    JSON.stringify({ method, params }),
    'nip04',
  )

  const requestEvent = new NDKEvent(ndk, {
    kind: 23194,
    content: encryptedContent,
    tags: [['p', conn.walletPubkey]],
  })
  await requestEvent.sign(clientSigner)
  await requestEvent.publish(relaySet)

  return new Promise((resolve, reject) => {
    const sub = ndk.subscribe(
      { kinds: [23195], authors: [conn.walletPubkey], '#e': [requestEvent.id] },
      undefined,
      relaySet,
    )

    const timeout = setTimeout(() => {
      sub.stop()
      reject(new Error('Wallet did not respond in time'))
    }, timeoutMs)

    sub.on('event', async (event: NDKEvent) => {
      clearTimeout(timeout)
      sub.stop()
      try {
        const decrypted = await clientSigner.decrypt(
          walletUser,
          event.content,
          'nip04',
        )
        const response = JSON.parse(decrypted)
        if (response.error) {
          reject(new Error(response.error.message ?? 'Wallet returned an error'))
        } else {
          resolve(response.result)
        }
      } catch (e) {
        reject(e)
      }
    })
  })
}

// Executes a real payment against whatever wallet the connection string
// points to — must only ever be called from an explicit user action (e.g.
// clicking "Pay"), never automatically or as part of any scripted flow.
export async function payInvoiceWithNwc(
  uri: string,
  invoice: string,
  timeoutMs = 30000,
): Promise<{ preimage: string }> {
  return sendNwcRequest(uri, 'pay_invoice', { invoice }, timeoutMs) as Promise<{
    preimage: string
  }>
}

// Read-only balance check — moves no funds, safe to call automatically.
// Some wallets scope their NWC connection string to exclude get_balance
// (the DVM's own operator connection is a real example of a narrower
// scope elsewhere in this project) — callers should treat a rejection as
// "balance unavailable," not a hard error.
export async function getWalletBalanceMsat(uri: string, timeoutMs = 15000): Promise<number> {
  const result = (await sendNwcRequest(uri, 'get_balance', {}, timeoutMs)) as {
    balance: number
  }
  return result.balance
}

// Real shapes below verified against docs.nwc.dev's own reference-api
// pages (fetched and read directly, not assumed) — the actively
// maintained NWC reference, not just the older core NIP-47 text, since
// list_transactions/get_info/make_invoice/lookup_invoice are documented
// there with real request/response examples. Two methods some wallet
// UIs show as permission toggles (sign_message, wallet-pushed
// notifications) are deliberately NOT implemented here: neither has a
// method defined in either the core NIP-47 spec or docs.nwc.dev's own
// reference-api index, so there's nothing real to call — shipping a
// guessed shape against financial infrastructure was judged worse than
// omitting the feature (confirmed with the user directly before
// proceeding).

export interface NwcWalletInfo {
  alias: string
  color: string
  pubkey: string
  network: string
  block_height: number
  block_hash: string
  methods: string[]
}

// Read-only — moves no funds, safe to call automatically.
export async function getWalletInfo(uri: string, timeoutMs = 15000): Promise<NwcWalletInfo> {
  return sendNwcRequest(uri, 'get_info', {}, timeoutMs) as Promise<NwcWalletInfo>
}

// Shared shape for both a single make_invoice/lookup_invoice result and
// each entry in list_transactions — identical fields per docs.nwc.dev.
export interface NwcTransaction {
  type: 'incoming' | 'outgoing'
  invoice?: string
  description?: string
  description_hash?: string
  preimage?: string
  payment_hash: string
  amount: number
  fees_paid?: number
  created_at: number
  expires_at?: number
  settled_at?: number
  metadata?: Record<string, unknown>
}

// Real money movement gated behind this only in the sense that it
// *creates* a real invoice a stranger could pay — the invoice itself
// moves no funds until someone actually pays it, so this is safe to
// call from a plain form submit, same posture as the Ark wallet's own
// createLightningInvoice().
export async function createInvoiceWithNwc(
  uri: string,
  args: { amountMsat: number; description?: string; expiry?: number },
  timeoutMs = 15000,
): Promise<NwcTransaction> {
  return sendNwcRequest(
    uri,
    'make_invoice',
    {
      amount: args.amountMsat,
      description: args.description,
      expiry: args.expiry,
    },
    timeoutMs,
  ) as Promise<NwcTransaction>
}

// Read-only — moves no funds, safe to call automatically. Exactly one
// of paymentHash/invoice should be given, matching the spec's own
// "either... or..." lookup shape.
export async function lookupInvoiceWithNwc(
  uri: string,
  args: { paymentHash?: string; invoice?: string },
  timeoutMs = 15000,
): Promise<NwcTransaction> {
  return sendNwcRequest(
    uri,
    'lookup_invoice',
    { payment_hash: args.paymentHash, invoice: args.invoice },
    timeoutMs,
  ) as Promise<NwcTransaction>
}

// Read-only — moves no funds, safe to call automatically. Per
// docs.nwc.dev: "from defaults to 0," "until defaults to the current
// time," results are in descending order of creation time.
export async function listTransactionsWithNwc(
  uri: string,
  args: {
    from?: number
    until?: number
    limit?: number
    offset?: number
    unpaid?: boolean
    type?: 'incoming' | 'outgoing'
  } = {},
  timeoutMs = 15000,
): Promise<NwcTransaction[]> {
  const result = (await sendNwcRequest(uri, 'list_transactions', args, timeoutMs)) as {
    transactions: NwcTransaction[]
  }
  return result.transactions
}
