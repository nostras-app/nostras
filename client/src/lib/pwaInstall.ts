import { useSyncExternalStore } from 'react'

// Chrome doesn't ship a TS type for this event.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type State = {
  deferredPrompt: BeforeInstallPromptEvent | null
  installed: boolean
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's legacy standalone flag — no display-mode media query
    // support there.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

let state: State = { deferredPrompt: null, installed: isStandalone() }
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Registered at module scope (not inside a component) since Chrome can
// fire this before React ever mounts — missing it would mean no install
// button for the rest of the session. Chrome shows its own mini-infobar
// by default unless preventDefault() is called; we call it so the app's
// own button is the only prompt, not both.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  state = { ...state, deferredPrompt: event as BeforeInstallPromptEvent }
  notify()
})

window.addEventListener('appinstalled', () => {
  state = { deferredPrompt: null, installed: true }
  notify()
})

export function useInstallPrompt() {
  return useSyncExternalStore(subscribe, () => state)
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = state.deferredPrompt
  if (!prompt) return 'unavailable'
  await prompt.prompt()
  const { outcome } = await prompt.userChoice
  // A used prompt can't be shown again — the next beforeinstallprompt
  // (if the browser decides to offer it again later) will replace it.
  state = { ...state, deferredPrompt: null }
  notify()
  return outcome
}
