// Minimal NIP-47 client for the agent's OWN wallet (AGENT_NWC_URI), ported
// from client/src/lib/nwc.ts. Never pointed at the operator's or the DVM's
// wallet: the only URI it ever reads is AGENT_NWC_URI.
import NDK, { NDKEvent, NDKPrivateKeySigner, NDKRelaySet } from '@nostr-dev-kit/ndk'

function parseNwcUri(uri) {
  const withoutScheme = uri.replace(/^nostr\+walletconnect:\/\//, '')
  const [walletPubkey, query = ''] = withoutScheme.split('?')
  const params = new URLSearchParams(query)
  const relays = params.getAll('relay')
  const secret = params.get('secret')
  if (!walletPubkey || relays.length === 0 || !secret) throw new Error('Invalid AGENT_NWC_URI')
  return { walletPubkey, relays, secret }
}

let cached = null
async function connection() {
  if (cached) return cached
  const uri = process.env.AGENT_NWC_URI
  if (!uri) throw new Error('AGENT_NWC_URI is not set')
  const conn = parseNwcUri(uri)
  const ndk = new NDK({ explicitRelayUrls: conn.relays })
  await ndk.connect(8000).catch(() => {})
  cached = { conn, ndk, signer: new NDKPrivateKeySigner(conn.secret) }
  return cached
}

async function request(method, params, timeoutMs = 20000) {
  const { conn, ndk, signer } = await connection()
  const walletUser = ndk.getUser({ pubkey: conn.walletPubkey })
  const relaySet = NDKRelaySet.fromRelayUrls(conn.relays, ndk)
  const content = await signer.encrypt(walletUser, JSON.stringify({ method, params }), 'nip04')
  const req = new NDKEvent(ndk, { kind: 23194, content, tags: [['p', conn.walletPubkey]] })
  await req.sign(signer)

  return new Promise((resolve, reject) => {
    const sub = ndk.subscribe(
      { kinds: [23195], authors: [conn.walletPubkey], '#e': [req.id] },
      { closeOnEose: false, relaySet },
    )
    const timer = setTimeout(() => {
      sub.stop()
      reject(new Error(`Wallet did not answer ${method} in time`))
    }, timeoutMs)
    sub.on('event', async (ev) => {
      clearTimeout(timer)
      sub.stop()
      try {
        const res = JSON.parse(await signer.decrypt(walletUser, ev.content, 'nip04'))
        if (res.error) reject(new Error(res.error.message ?? 'Wallet error'))
        else resolve(res.result)
      } catch (e) {
        reject(e)
      }
    })
    req.publish(relaySet).catch((e) => {
      clearTimeout(timer)
      sub.stop()
      reject(e)
    })
  })
}

export async function getBalanceSats() {
  const r = await request('get_balance', {})
  return Math.floor(r.balance / 1000)
}

export async function listTransactions(limit = 20) {
  const r = await request('list_transactions', { limit })
  return r.transactions ?? []
}

// Moves real sats. Only tool.js's `zap` command calls this, after every
// limit check has passed, and never in dry-run mode.
export async function payInvoice(invoice) {
  return request('pay_invoice', { invoice }, 45000)
}
