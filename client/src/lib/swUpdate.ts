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
//
// Real bug (2026-08-10): the original guard was a plain in-memory
// `reloaded` boolean — but window.location.reload() tears down the whole
// JS context, so that boolean resets to false on the very page load it
// just triggered. If several deploys land in quick succession (this
// project shipped four client deploys in one session), a tab left open
// across that window can chase each new service worker with its own
// reload — one legitimate reload per version, but in rapid enough
// succession to look and feel like an infinite loop to whoever's staring
// at the screen. Fixed by recording the last auto-reload's timestamp in
// sessionStorage (survives the reload, unlike an in-memory flag) and
// suppressing a repeat within a short cooldown — the tab still converges
// on the latest version, just without visibly thrashing through every
// intermediate one.
const RELOAD_TIMESTAMP_KEY = 'nostras:sw-reload-at'
const RELOAD_COOLDOWN_MS = 15000

export function installServiceWorkerReload() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const lastReload = Number(sessionStorage.getItem(RELOAD_TIMESTAMP_KEY) ?? 0)
    if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return
    sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now()))
    window.location.reload()
  })
}
