import { useSyncExternalStore } from 'react'
import type { View } from '../components/NavRail'

type NavState = { view: View; profilePubkey: string | null }

let state: NavState = { view: 'home', profilePubkey: null }
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Switching tabs via the nav rail always resets the profile panel back to
// "my own profile" — distinct from viewProfile(), the only way a specific
// other pubkey gets shown there. Without this reset, clicking Home then
// back to the profile tab could leave a previously-viewed stranger's
// profile showing instead of your own.
export function setActiveView(view: View) {
  state = { view, profilePubkey: null }
  notify()
}

// Opens another user's profile from anywhere in the app (e.g. clicking an
// author's name in the feed) without prop-drilling a callback through
// every component that renders a FeedItem (Feed, SearchView,
// BookmarksView, ProfileView's own notes list all share it).
export function viewProfile(pubkey: string) {
  state = { view: 'profile', profilePubkey: pubkey }
  notify()
}

export function useNavState(): NavState {
  return useSyncExternalStore(subscribe, () => state)
}
