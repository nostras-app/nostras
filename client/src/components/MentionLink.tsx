import { useState } from 'react'
import { NDKRelaySet, nip19 } from '@nostr-dev-kit/ndk'
import type { MentionDecoded } from '../lib/parseContent'
import { ndk, localRelayUrl, publicRelayUrls } from '../lib/ndk'
import { makeRelayConnectionFilter } from '../lib/relayFilter'
import { viewProfile, viewNote, viewArticle } from '../lib/navigation'
import { useProfile } from '../hooks/useProfile'

// Same untrusted-third-party-relay-hint guard already used by SearchView's
// and deeplink.ts's own note/nevent resolution — a mention's relay hints
// come from whoever encoded the nostr: URI, not from us.
const isAllowedRelayUrl = makeRelayConnectionFilter(localRelayUrl)

function shorten(s: string): string {
  return s.length > 20 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s
}

async function fetchById(id: string, relayHints: string[]) {
  const hintUrls = relayHints.filter(isAllowedRelayUrl)
  const relaySet = NDKRelaySet.fromRelayUrls(
    Array.from(new Set([localRelayUrl, ...publicRelayUrls, ...hintUrls])),
    ndk,
  )
  try {
    return await ndk.fetchEvent({ ids: [id] }, undefined, relaySet)
  } catch {
    return null
  }
}

async function fetchArticle(pubkey: string, identifier: string, relayHints: string[]) {
  const hintUrls = relayHints.filter(isAllowedRelayUrl)
  const relaySet = NDKRelaySet.fromRelayUrls(
    Array.from(new Set([localRelayUrl, ...publicRelayUrls, ...hintUrls])),
    ndk,
  )
  try {
    return await ndk.fetchEvent(
      { kinds: [30023], authors: [pubkey], '#d': [identifier] },
      undefined,
      relaySet,
    )
  } catch {
    return null
  }
}

// A NIP-27 nostr: mention rendered inline in note content. npub/nprofile
// navigate immediately (viewProfile only needs the pubkey — ProfileView
// fetches the rest); note/nevent/naddr need a real NDKEvent in hand first
// (viewNote/viewArticle's existing contract, matching SearchView's own
// note-reference resolution), so those resolve on click rather than on
// render — resolving every mention in a busy feed eagerly would mean a lot
// of unrequested relay fetches for links most readers never follow.
export function MentionLink({ decoded }: { decoded: MentionDecoded }) {
  const [resolving, setResolving] = useState(false)
  const [notFound, setNotFound] = useState(false)

  if (decoded.type === 'npub' || decoded.type === 'nprofile') {
    const pubkey = decoded.type === 'npub' ? decoded.data : decoded.data.pubkey
    return <ProfileMention pubkey={pubkey} />
  }

  if (decoded.type === 'note' || decoded.type === 'nevent') {
    const id = decoded.type === 'note' ? decoded.data : decoded.data.id
    const relays = decoded.type === 'nevent' ? (decoded.data.relays ?? []) : []
    return (
      <button
        type="button"
        className="mention-link"
        disabled={resolving}
        onClick={async () => {
          setResolving(true)
          const event = await fetchById(id, relays)
          setResolving(false)
          if (event) viewNote(event)
          else setNotFound(true)
        }}
      >
        {resolving ? 'note:…' : notFound ? 'note (not found)' : `note:${shorten(id)}`}
      </button>
    )
  }

  // naddr — only kind:30023 (articles) has somewhere to navigate to in
  // this app, matching lib/deeplink.ts's own established scope for naddr.
  // Any other kind renders as a plain, non-clickable shortened reference
  // rather than a link to nowhere.
  if (decoded.data.kind !== 30023) {
    return <span className="mention-link mention-link-inert">{shorten(decoded.data.identifier)}</span>
  }
  return (
    <button
      type="button"
      className="mention-link"
      disabled={resolving}
      onClick={async () => {
        setResolving(true)
        const event = await fetchArticle(decoded.data.pubkey, decoded.data.identifier, decoded.data.relays ?? [])
        setResolving(false)
        if (event) viewArticle(event)
        else setNotFound(true)
      }}
    >
      {resolving ? 'article:…' : notFound ? 'article (not found)' : `article:${shorten(decoded.data.identifier)}`}
    </button>
  )
}

function ProfileMention({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey)
  const label = profile?.name ? `@${profile.name}` : `@${shorten(nip19.npubEncode(pubkey))}`
  return (
    <button type="button" className="mention-link" onClick={() => viewProfile(pubkey)}>
      {label}
    </button>
  )
}
