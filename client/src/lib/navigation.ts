import { useSyncExternalStore } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { View } from '../components/NavRail'

type NavState = {
  view: View
  profilePubkey: string | null
  article: NDKEvent | null
  note: NDKEvent | null
  dmTarget: string | null
}

let state: NavState = { view: 'home', profilePubkey: null, article: null, note: null, dmTarget: null }
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Switching tabs via the nav rail always resets the profile/article/note/dm
// panels back to their defaults — distinct from viewProfile()/viewArticle()/
// viewNote()/startDmWith(), the only ways a specific pubkey/article/note/dm
// target get shown there. Without this reset, clicking Home then back could
// leave a previously-viewed stranger's profile, an old article, a stale
// single-note view, or a stale DM thread still showing.
export function setActiveView(view: View) {
  state = { view, profilePubkey: null, article: null, note: null, dmTarget: null }
  notify()
}

// Opens another user's profile from anywhere in the app (e.g. clicking an
// author's name in the feed) without prop-drilling a callback through
// every component that renders a FeedItem (Feed, SearchView,
// BookmarksView, ProfileView's own notes list all share it).
export function viewProfile(pubkey: string) {
  state = { view: 'profile', profilePubkey: pubkey, article: null, note: null, dmTarget: null }
  notify()
}

// Opens a NIP-23 article's full reading view — takes the already-fetched
// NDKEvent directly (from whatever feed/card the user clicked) rather than
// an naddr + a fresh relay lookup, since the event is already in hand.
export function viewArticle(event: NDKEvent) {
  state = { view: 'article', profilePubkey: null, article: event, note: null, dmTarget: null }
  notify()
}

// Opens a single-note view (SearchView pasting a note/nevent reference,
// or a future nevent deep link) — same "already-fetched event in hand"
// shape as viewArticle. Closes a real, previously-documented gap:
// deeplink.ts used to say "NOSTRAS has no dedicated single-note view to
// redirect a plain nevent to" — this is that view.
export function viewNote(event: NDKEvent) {
  state = { view: 'note', profilePubkey: null, article: null, note: event, dmTarget: null }
  notify()
}

// Opens the Messages view with a specific pubkey's conversation already
// selected — used by AboutModal's "Message the developer" action, reusing
// the exact same DM machinery MessagesView's own "start a new conversation
// by npub" input already uses.
export function startDmWith(pubkey: string) {
  state = { view: 'messages', profilePubkey: null, article: null, note: null, dmTarget: pubkey }
  notify()
}

export function useNavState(): NavState {
  return useSyncExternalStore(subscribe, () => state)
}
