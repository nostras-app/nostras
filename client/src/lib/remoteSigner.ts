import { NDKNip46Signer, NDKNip07Signer, type NDKUser } from '@nostr-dev-kit/ndk'
import { ndk } from './ndk'
import { getDevSigner } from './signer'

const MODE_KEY = 'nostras:signer-mode'
const URI_KEY = 'nostras:remote-signer-uri'
const LOCAL_KEY_KEY = 'nostras:remote-signer-local-key'

type SignerMode = 'nip46' | 'nip07'

interface RemoteSignerSession {
  uri: string
  localKey: string
}

export function hasNip07Extension(): boolean {
  return typeof window !== 'undefined' && 'nostr' in window
}

export function getSavedRemoteSignerSession(): RemoteSignerSession | null {
  const uri = localStorage.getItem(URI_KEY)
  const localKey = localStorage.getItem(LOCAL_KEY_KEY)
  if (!uri || !localKey) return null
  return { uri, localKey }
}

export function getSavedSignerMode(): SignerMode | null {
  const mode = localStorage.getItem(MODE_KEY)
  return mode === 'nip46' || mode === 'nip07' ? mode : null
}

function saveBunkerSession(uri: string, signer: NDKNip46Signer) {
  localStorage.setItem(MODE_KEY, 'nip46' satisfies SignerMode)
  localStorage.setItem(URI_KEY, uri)
  localStorage.setItem(LOCAL_KEY_KEY, signer.localSigner.privateKey)
}

// Exported separately from disconnectSigner() below — logOff() (lib/
// authState.ts) needs to clear a NIP-46/07 session WITHOUT falling back
// to the dev key the way a plain "Disconnect" does, since logging off
// should return to AuthGate's own choice screen, not silently swap to a
// different identity.
export function clearSignerSession() {
  localStorage.removeItem(MODE_KEY)
  localStorage.removeItem(URI_KEY)
  localStorage.removeItem(LOCAL_KEY_KEY)
}

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

// Real interop gap, found by reading the installed NDK's own source
// (node_modules/@nostr-dev-kit/ndk): NDKNip46Signer.blockUntilReady()'s
// `connect` RPC only accepts the literal string "ack" as a successful
// response and rejects anything else. Some remote signers (confirmed with
// Amethyst on Android) instead ack `connect` by echoing back the `secret`
// query param — the more secure convention (it proves the responder
// actually received our secret, not just any relay replaying "ack"), but
// this NDK version doesn't check for it, so a real, user-approved
// connection was being reported as "failed to connect".
//
// By the time blockUntilReady() rejects this way, the user has already
// tapped Connect on the remote signer and its RPC subscription is live —
// a direct get_public_key call, which only the bunker holding the
// matching key could answer on our private response channel, succeeds
// where the stricter ack check just failed. This isn't a weaker check:
// a genuinely-declined or unreachable bunker fails this the same way (or
// times out, handled below), so it only recovers the false-negative case.
async function blockUntilReadyWithAckFallback(signer: NDKNip46Signer): Promise<NDKUser> {
  try {
    return await signer.blockUntilReady()
  } catch (originalError) {
    try {
      const pubkey = await withTimeout(
        signer.getPublicKey(),
        10000,
        'Timed out waiting for the remote signer to confirm the connection',
      )
      if (!pubkey) throw new Error('Remote signer did not confirm the connection')
      signer.userPubkey = pubkey
      const user = ndk.getUser({ pubkey })
      // blockUntilReady()'s own success path sets this same private field
      // before resolving. NDK's `ndk.signer = signer` setter calls
      // signer.user() internally, which returns it directly if set, or
      // otherwise silently re-runs blockUntilReady() (no .catch() on that
      // internal call) — re-sending a second connect RPC and failing the
      // same way again, with no error ever surfacing. Has to be set here
      // for this workaround to actually stick past the initial connect.
      ;(signer as unknown as { _user?: NDKUser })._user = user
      return user
    } catch {
      // NDK's own rejection reason (response.error) is often a bare
      // string, not an Error — e.g. a real "user declined" from the
      // bunker — so preserve that text rather than discarding it for a
      // generic message.
      if (originalError instanceof Error) throw originalError
      throw new Error(typeof originalError === 'string' ? originalError : 'Failed to connect')
    }
  }
}

// Connects to a bunker:// URI (NIP-46). Reuses the saved local connection
// key when reconnecting to the same bunker so the remote signer recognizes
// this session without the user having to re-approve it.
export async function connectBunker(uri: string) {
  const saved = getSavedRemoteSignerSession()
  const localKey = saved?.uri === uri ? saved.localKey : undefined

  const signer = NDKNip46Signer.bunker(ndk, uri, localKey)
  const user = await blockUntilReadyWithAckFallback(signer)

  saveBunkerSession(uri, signer)
  ndk.signer = signer
  return user
}

// Connects via a NIP-07 browser extension (e.g. Alby, nos2x). Nothing to
// persist beyond the mode flag — the extension itself holds the session.
export async function connectExtension() {
  const signer = new NDKNip07Signer()
  const user = await signer.blockUntilReady()

  localStorage.setItem(MODE_KEY, 'nip07' satisfies SignerMode)
  ndk.signer = signer
  return user
}

export async function restoreSignerSession() {
  const mode = getSavedSignerMode()
  if (mode === 'nip46') {
    const saved = getSavedRemoteSignerSession()
    if (!saved) return null
    const signer = NDKNip46Signer.bunker(ndk, saved.uri, saved.localKey)
    const user = await blockUntilReadyWithAckFallback(signer)
    ndk.signer = signer
    return { user, mode }
  }
  if (mode === 'nip07') {
    const signer = new NDKNip07Signer()
    const user = await signer.blockUntilReady()
    ndk.signer = signer
    return { user, mode }
  }
  return null
}

export function disconnectSigner() {
  clearSignerSession()
  ndk.signer = getDevSigner()
}
