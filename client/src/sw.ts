/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'

// vite-plugin-pwa doesn't ship a type for the injected precache manifest —
// this is the standard Workbox injectManifest declaration.
declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

self.skipWaiting()
clientsClaim()

// self.__WB_MANIFEST is replaced at build time (workbox-build's
// injectManifest step) with the actual list of precached asset URLs —
// same precaching NOSTRAS already had under the previous auto-generated
// service worker, just now alongside our own push handlers below.
precacheAndRoute(self.__WB_MANIFEST)

// Push payloads are always the small {title, body} JSON shape the server
// sends (server/push_notify.go) — deliberately generic, never actual note/
// DM content (for DMs the server can't decrypt it anyway).
self.addEventListener('push', (event) => {
  if (!event.data) return
  let data: { title?: string; body?: string }
  try {
    data = event.data.json()
  } catch {
    return
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'NOSTRAS', {
      body: data.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow('/')
    }),
  )
})
