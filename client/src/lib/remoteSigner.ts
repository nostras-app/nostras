import { NDKNip46Signer, NDKNip07Signer } from '@nostr-dev-kit/ndk'
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

function clearSession() {
  localStorage.removeItem(MODE_KEY)
  localStorage.removeItem(URI_KEY)
  localStorage.removeItem(LOCAL_KEY_KEY)
}

// Connects to a bunker:// URI (NIP-46). Reuses the saved local connection
// key when reconnecting to the same bunker so the remote signer recognizes
// this session without the user having to re-approve it.
export async function connectBunker(uri: string) {
  const saved = getSavedRemoteSignerSession()
  const localKey = saved?.uri === uri ? saved.localKey : undefined

  const signer = NDKNip46Signer.bunker(ndk, uri, localKey)
  const user = await signer.blockUntilReady()

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
    const user = await signer.blockUntilReady()
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
  clearSession()
  ndk.signer = getDevSigner()
}
