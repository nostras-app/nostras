import { useSyncExternalStore } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import type { View } from '../components/NavRail'

type NavState = {
  view: View
  profilePubkey: string | null
  article: NDKEvent | null
  note: NDKEvent | null
  thread: NDKEvent | null
  episode: NDKEvent | null
  listing: NDKEvent | null
  dmTarget: string | null
  groupTarget: string | null
}

let state: NavState = {
  view: 'home',
  profilePubkey: null,
  article: null,
  note: null,
  thread: null,
  episode: null,
  listing: null,
  dmTarget: null,
  groupTarget: null,
}
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Switching tabs via the nav rail always resets the profile/article/note/
// thread/episode/listing/dm/group panels back to their defaults —
// distinct from viewProfile()/viewArticle()/viewNote()/viewThread()/
// viewEpisode()/viewListing()/startDmWith()/viewGroup(), the only ways a
// specific pubkey/article/note/thread/episode/listing/dm/group target get
// shown there. Without this reset, clicking Home then back could leave a
// previously-viewed stranger's profile, an old article, a stale
// single-note view, a stale thread, a stale episode, a stale listing, a
// stale DM thread, or a stale group chat still showing.
export function setActiveView(view: View) {
  state = {
    view,
    profilePubkey: null,
    article: null,
    note: null,
    thread: null,
    episode: null,
    listing: null,
    dmTarget: null,
    groupTarget: null,
  }
  notify()
}

// Opens another user's profile from anywhere in the app (e.g. clicking an
// author's name in the feed) without prop-drilling a callback through
// every component that renders a FeedItem (Feed, SearchView,
// BookmarksView, ProfileView's own notes list all share it).
export function viewProfile(pubkey: string) {
  state = {
    view: 'profile',
    profilePubkey: pubkey,
    article: null,
    note: null,
    thread: null,
    episode: null,
    listing: null,
    dmTarget: null,
    groupTarget: null,
  }
  notify()
}

// Opens a NIP-23 article's full reading view — takes the already-fetched
// NDKEvent directly (from whatever feed/card the user clicked) rather than
// an naddr + a fresh relay lookup, since the event is already in hand.
export function viewArticle(event: NDKEvent) {
  state = {
    view: 'article',
    profilePubkey: null,
    article: event,
    note: null,
    thread: null,
    episode: null,
    listing: null,
    dmTarget: null,
    groupTarget: null,
  }
  notify()
}

// Opens a single-note view (SearchView pasting a note/nevent reference,
// or a future nevent deep link) — same "already-fetched event in hand"
// shape as viewArticle. Closes a real, previously-documented gap:
// deeplink.ts used to say "NOSTRAS has no dedicated single-note view to
// redirect a plain nevent to" — this is that view.
export function viewNote(event: NDKEvent) {
  state = {
    view: 'note',
    profilePubkey: null,
    article: null,
    note: event,
    thread: null,
    episode: null,
    listing: null,
    dmTarget: null,
    groupTarget: null,
  }
  notify()
}

// Opens a NIP-7D forum thread's full reading view — same "already-fetched
// event in hand" shape as viewArticle/viewNote, reached by clicking a
// ThreadCard in the feed.
export function viewThread(event: NDKEvent) {
  state = {
    view: 'thread',
    profilePubkey: null,
    article: null,
    note: null,
    thread: event,
    episode: null,
    listing: null,
    dmTarget: null,
    groupTarget: null,
  }
  notify()
}

// Opens a NIP-F4 podcast episode's full reading view — same "already-
// fetched event in hand" shape as viewArticle/viewNote/viewThread,
// reached by clicking a PodcastEpisodeCard in the feed.
export function viewEpisode(event: NDKEvent) {
  state = {
    view: 'episode',
    profilePubkey: null,
    article: null,
    note: null,
    thread: null,
    episode: event,
    listing: null,
    dmTarget: null,
    groupTarget: null,
  }
  notify()
}

// Opens a NIP-99 classified listing's full view — same "already-fetched
// event in hand" shape as viewArticle/viewNote/viewThread/viewEpisode,
// reached by clicking a ListingCard in the feed or the Marketplace view.
export function viewListing(event: NDKEvent) {
  state = {
    view: 'listing',
    profilePubkey: null,
    article: null,
    note: null,
    thread: null,
    episode: null,
    listing: event,
    dmTarget: null,
    groupTarget: null,
  }
  notify()
}

// Opens the Messages view with a specific pubkey's conversation already
// selected — used by AboutModal's "Message the developer" action, reusing
// the exact same DM machinery MessagesView's own "start a new conversation
// by npub" input already uses.
export function startDmWith(pubkey: string) {
  state = {
    view: 'messages',
    profilePubkey: null,
    article: null,
    note: null,
    thread: null,
    episode: null,
    listing: null,
    dmTarget: pubkey,
    groupTarget: null,
  }
  notify()
}

// Opens a specific group's chat view within Communities — used when
// clicking a group card in the discovery list. Just an id (not an
// already-fetched event, unlike viewArticle/viewNote/viewThread/
// viewEpisode/viewListing): group state is a live subscription
// (useGroupChat/useGroupList), not a one-off fetch.
export function viewGroup(groupId: string) {
  state = {
    view: 'communities',
    profilePubkey: null,
    article: null,
    note: null,
    thread: null,
    episode: null,
    listing: null,
    dmTarget: null,
    groupTarget: groupId,
  }
  notify()
}

export function useNavState(): NavState {
  return useSyncExternalStore(subscribe, () => state)
}
