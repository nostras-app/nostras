import { useSyncExternalStore } from 'react'
import { ndk } from './ndk'
import { clearSignerSession } from './remoteSigner'

// 'locked': the active identity is a real, saved one, but it's NIP-49
// encrypted and this tab hasn't unlocked it yet — distinct from
// 'needs-choice' (no identity at all / nothing to restore). Renders
// UnlockIdentityGate instead of either AuthGate or the main app.
export type AuthState = 'checking' | 'needs-choice' | 'locked' | 'ready'

// Module-level shared state (same useSyncExternalStore pattern as
// lib/navigation.ts) rather than App.tsx local useState — logOff() below
// needs to flip this from deep inside the settings panel (SignerConnect's
// nesting level) without prop-drilling a callback down through every
// intermediate component.
let state: AuthState = 'checking'
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setAuthState(next: AuthState) {
  state = next
  notify()
}

export function useAuthState(): AuthState {
  return useSyncExternalStore(subscribe, () => state)
}

// Real gap reported by the user (2026-08-08): there was no way to log off
// at all — the existing "Disconnect" button (remoteSigner.ts) is scoped
// to swapping away from a NIP-46/07 signer specifically, and silently
// falls back to the dev key rather than returning to AuthGate's own
// choice screen. logOff() clears any remote-signer session and drops the
// active ndk.signer entirely, then flips back to 'needs-choice' so
// AuthGate renders again.
//
// Deliberately does NOT delete any local identity from localStorage —
// identities.ts's getActiveIdentitySigner() already returns the active
// saved identity if one is present rather than minting a fresh one, so
// choosing "Continue anonymously" again after logging off seamlessly
// restores the exact same identity. Actually forgetting/discarding a key
// forever would be a much more consequential, separate action, not
// something a plain "log off" should do as a side effect.
export function logOff() {
  clearSignerSession()
  ndk.signer = undefined
  setAuthState('needs-choice')
}
