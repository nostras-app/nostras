import { useCallback, useState } from 'react'

export type SwUpdateStatus = 'unsupported' | 'idle' | 'checking' | 'updating' | 'up-to-date' | 'error'

// A browser only checks for a new service worker periodically (roughly
// once a day by default) plus on fresh navigations — fine for a regular
// tab, which gets fresh navigations often just from normal use, but an
// installed PWA someone leaves open for days can sit on a stale version
// far longer before that automatic check even runs. This gives Settings
// a manual "check now" escape hatch, prompted directly by a user hitting
// a stale-tab bug that a reload fixed — swUpdate.ts's global
// controllerchange listener already handles reloading once an update
// actually lands; this just triggers the check sooner than the browser
// otherwise would on its own.
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
      if (!registration) {
        setStatus('error')
        setError('No active service worker registration found')
        return
      }
      let found = false
      const onUpdateFound = () => {
        found = true
      }
      registration.addEventListener('updatefound', onUpdateFound)
      await registration.update()
      // registration.update()'s own promise isn't guaranteed to resolve
      // strictly after "updatefound" fires across browsers, so a short
      // grace window is more reliable than assuming either ordering.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      registration.removeEventListener('updatefound', onUpdateFound)
      // If found, a new service worker is installing/activating — sw.ts
      // already calls skipWaiting()+clientsClaim() unconditionally, so it
      // takes over on its own within a moment, and the existing global
      // controllerchange listener (swUpdate.ts) reloads the page then.
      // Nothing more to do here in either case.
      setStatus(found ? 'updating' : 'up-to-date')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Update check failed')
    }
  }, [])

  return { status, error, checkForUpdate }
}
