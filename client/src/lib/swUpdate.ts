// Reloads the page exactly once when a new service worker takes control of
// it. Necessary because sw.ts calls self.skipWaiting() + clientsClaim() —
// the new service worker activates and starts controlling this tab
// immediately on deploy, without waiting for it to close/reopen, but the
// OLD JS bundle (React, NDK, all in-memory module state) keeps running
// against it. That mismatch is a real, previously-observed bug (see
// CLAUDE.md's "stuck browser tab" entries): a tab left open across a
// deploy could end up stuck showing only the header/logo, since the
// running code and the service worker underneath it silently disagreed
// about what version of the app this is. This is the standard fix for
// this exact Workbox pattern — reload on `controllerchange`, guarded so
// it only fires once (the first activation of any service worker also
// counts as a controllerchange, so a brand-new visitor gets one harmless
// extra reload on their very first visit).
export function installServiceWorkerReload() {
  if (!('serviceWorker' in navigator)) return
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
}
