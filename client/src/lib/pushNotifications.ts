import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, localRelayUrl } from './ndk'

// The relay's HTTP push-registration endpoints (server/push_handlers.go)
// live at the same host as the WebSocket relay — ws(s):// -> http(s)://.
const pushApiBase = localRelayUrl.replace(/^ws/, 'http').replace(/\/$/, '')

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY
}

// PushManager.subscribe() needs applicationServerKey as a raw Uint8Array,
// not the base64url string the server hands out.
function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

// NIP-98 HTTP Auth: signs a kind:27235 event proving this request is really
// coming from whoever holds the active signer's key, so the server can
// trust the pubkey in a subscribe/unsubscribe request instead of accepting
// any pubkey a caller claims (see server/nip98.go).
async function buildNip98AuthHeader(url: string, method: string): Promise<string> {
  const event = new NDKEvent(ndk, {
    kind: 27235,
    content: '',
    tags: [
      ['u', url],
      ['method', method],
    ],
  })
  await event.sign()
  return `Nostr ${btoa(JSON.stringify(event.rawEvent()))}`
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) {
    throw new Error('Push notifications are not supported in this browser or environment')
  }
  if (!ndk.signer) {
    throw new Error('No signer connected')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted')
  }

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  })

  const url = `${pushApiBase}/push/subscribe`
  const authHeader = await buildNip98AuthHeader(url, 'POST')
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  })
  if (!res.ok) {
    await subscription.unsubscribe()
    throw new Error(`Server rejected the subscription (${res.status})`)
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingPushSubscription()
  if (!subscription) return

  if (ndk.signer) {
    try {
      const url = `${pushApiBase}/push/unsubscribe`
      const authHeader = await buildNip98AuthHeader(url, 'POST')
      await fetch(url, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      })
    } catch {
      // Still unsubscribe locally even if telling the server failed — the
      // browser-side subscription is what actually controls whether this
      // device keeps receiving pushes.
    }
  }

  await subscription.unsubscribe()
}
