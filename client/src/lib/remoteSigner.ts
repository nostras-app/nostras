import { NDKNip46Signer } from '@nostr-dev-kit/ndk'
import { ndk } from './ndk'
import { getDevSigner } from './signer'

const URI_KEY = 'nostras:remote-signer-uri'
const LOCAL_KEY_KEY = 'nostras:remote-signer-local-key'

interface RemoteSignerSession {
  uri: string
  localKey: string
}

export function getSavedRemoteSignerSession(): RemoteSignerSession | null {
  const uri = localStorage.getItem(URI_KEY)
  const localKey = localStorage.getItem(LOCAL_KEY_KEY)
  if (!uri || !localKey) return null
  return { uri, localKey }
}

function saveRemoteSignerSession(uri: string, signer: NDKNip46Signer) {
  localStorage.setItem(URI_KEY, uri)
  localStorage.setItem(LOCAL_KEY_KEY, signer.localSigner.privateKey)
}

export function clearRemoteSignerSession() {
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

  saveRemoteSignerSession(uri, signer)
  ndk.signer = signer
  return user
}

export async function restoreRemoteSignerSession() {
  const saved = getSavedRemoteSignerSession()
  if (!saved) return null

  const signer = NDKNip46Signer.bunker(ndk, saved.uri, saved.localKey)
  const user = await signer.blockUntilReady()
  ndk.signer = signer
  return user
}

export function disconnectRemoteSigner() {
  clearRemoteSignerSession()
  ndk.signer = getDevSigner()
}
