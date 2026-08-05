import { useSyncExternalStore } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { View } from '../components/NavRail'

type NavState = { view: View; profilePubkey: string | null; article: NDKEvent | null }

let state: NavState = { view: 'home', profilePubkey: null, article: null }
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Switching tabs via the nav rail always resets the profile/article panels
// back to their defaults — distinct from viewProfile()/viewArticle(), the
// only ways a specific pubkey/article get shown there. Without this reset,
// clicking Home then back could leave a previously-viewed stranger's
// profile or an old article still showing.
export function setActiveView(view: View) {
  state = { view, profilePubkey: null, article: null }
  notify()
}

// Opens another user's profile from anywhere in the app (e.g. clicking an
// author's name in the feed) without prop-drilling a callback through
// every component that renders a FeedItem (Feed, SearchView,
// BookmarksView, ProfileView's own notes list all share it).
export function viewProfile(pubkey: string) {
  state = { view: 'profile', profilePubkey: pubkey, article: null }
  notify()
}

// Opens a NIP-23 article's full reading view — takes the already-fetched
// NDKEvent directly (from whatever feed/card the user clicked) rather than
// an naddr + a fresh relay lookup, since the event is already in hand.
export function viewArticle(event: NDKEvent) {
  state = { view: 'article', profilePubkey: null, article: event }
  notify()
}

export function useNavState(): NavState {
  return useSyncExternalStore(subscribe, () => state)
}
