import { useCallback, useState } from 'react'

export type SwUpdateStatus = 'unsupported' | 'idle' | 'checking' | 'updating' | 'error'

// A browser only checks for a new service worker periodically (roughly
// once a day by default) plus on fresh navigations — fine for a regular
// tab, which gets fresh navigations often just from normal use, but an
// installed PWA someone leaves open for days can sit on a stale version
// far longer before that automatic check even runs. This gives Settings
// a manual "force it now" escape hatch.
//
// Real gap found live (2026-08-16): the original implementation only
// called registration.update() and trusted the browser's own SW-update
// lifecycle (install → skipWaiting → clientsClaim → controllerchange →
// swUpdate.ts's reload) to complete correctly on its own. Real user
// reports showed that lifecycle doesn't always finish reliably even
// after clicking this exact button — on desktop, sometimes needing an
// actual Ctrl+Shift+R; on a mobile PWA, no equivalent gesture exists at
// all, so a stuck tab had no recovery path whatsoever. JavaScript has no
// API for a genuine hard-reload/cache-bypass-everything reload — that's
// a real, permanent browser platform boundary, not something fixable
// from application code — but explicitly unregistering the current
// service worker and clearing every Cache Storage entry before reloading
// is the closest reachable equivalent: it guarantees the next load has
// no old worker left to intercept anything and nothing cached to serve
// stale, forcing a genuinely fresh fetch of everything from network. This
// button is now an explicit "start over completely" action, not a
// passive "is there anything new" check — it always reloads, whether or
// not an update was actually pending, matching what a real hard refresh
// does regardless of whether the page happened to be stale.
export function useServiceWorkerUpdate() {
  const [status, setStatus] = useState<SwUpdateStatus>(
    'serviceWorker' in navigator ? 'idle' : 'unsupported',
  )
  const [error, setError] = useState<string | null>(null)

  const checkForUpdate = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return
    setStatus('checking')
    setError(null)
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) await registration.unregister()
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
      setStatus('updating')
      window.location.reload()
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Update check failed')
    }
  }, [])

  return { status, error, checkForUpdate }
}
