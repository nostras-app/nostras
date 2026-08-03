import { NDKEvent, NDKPrivateKeySigner, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { ndk } from './ndk'

const NWC_URI_KEY = 'nostras:nwc-uri'

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
  localStorage.setItem(NWC_URI_KEY, uri)
}

export function getSavedNwcUri(): string | null {
  return localStorage.getItem(NWC_URI_KEY)
}

export function clearNwcUri() {
  localStorage.removeItem(NWC_URI_KEY)
}

// Sends a NIP-47 pay_invoice request to the connected wallet and waits for
// its response. This executes a real payment against whatever wallet the
// connection string points to — must only ever be called from an explicit
// user action (e.g. clicking "Pay"), never automatically.
export async function payInvoiceWithNwc(
  uri: string,
  invoice: string,
  timeoutMs = 30000,
): Promise<{ preimage: string }> {
  const conn = parseNwcUri(uri)
  const clientSigner = new NDKPrivateKeySigner(conn.secret)
  const walletUser = ndk.getUser({ pubkey: conn.walletPubkey })
  const relaySet = NDKRelaySet.fromRelayUrls([conn.relay], ndk)

  const encryptedContent = await clientSigner.encrypt(
    walletUser,
    JSON.stringify({ method: 'pay_invoice', params: { invoice } }),
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
