import { nip19 } from '@nostr-dev-kit/ndk'
import { ndk } from './ndk'
import { viewArticle } from './navigation'

// Resolves a `?nostr=<naddr1...>` deep link on load into a real in-app
// navigation — the client half of the kind:31990 NIP-89 handler
// announcement's `web` redirect tag (server/cmd/dvm/main.go publishes the
// server side). Without this, that announcement would advertise a URL
// another Nostr client could send a user to for "open this article in
// NOSTRAS" that didn't actually go anywhere once they arrived. Only
// naddr/kind:30023 is handled — NOSTRAS has no dedicated single-note view
// to redirect a plain nevent to, so that case is deliberately left alone
// rather than redirecting somewhere misleading.
export async function resolveDeepLinkFromUrl(): Promise<boolean> {
  const raw = new URLSearchParams(window.location.search).get('nostr')
  if (!raw) return false

  try {
    const decoded = nip19.decode(raw)
    if (decoded.type === 'naddr' && decoded.data.kind === 30023) {
      const event = await ndk.fetchEvent({
        kinds: [30023],
        authors: [decoded.data.pubkey],
        '#d': [decoded.data.identifier],
      })
      if (event) {
        viewArticle(event)
        return true
      }
    }
  } catch {
    // Malformed or unsupported entity in the URL — ignore, boot normally.
  }
  return false
}
