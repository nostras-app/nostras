import { useState, type KeyboardEvent } from 'react'
import { NDKRelaySet, NDKSubscriptionCacheUsage, type NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, localRelaySet, localRelayUrl, publicRelayUrls } from '../lib/ndk'
import { resolvePubkeyInput, resolveNoteReference } from '../lib/resolvePubkey'
import { makeRelayConnectionFilter } from '../lib/relayFilter'
import { viewProfile, viewNote } from '../lib/navigation'
import { FeedItem } from './Feed'
import { SearchIcon } from './icons'

type State = 'idle' | 'loading' | 'results' | 'empty' | 'error'

// Same untrusted-third-party-data guard already used for outbox-discovered
// relays and DM recipient relay lists — an nevent's relay hints come from
// whoever encoded the link, not from us, so they're filtered through the
// same private/local-address check before ever being used to construct a
// relay set.
const isAllowedRelayUrl = makeRelayConnectionFilter(localRelayUrl)

// Real bug (2026-08-09): unlike ndk.fetchEvent() (singular), which has a
// hard 10s internal fallback, ndk.fetchEvents() (plural, used below) only
// ever resolves on the queried relay's EOSE — if that connection never
// completes (a network hiccup, a slow/unreachable relay), the promise
// never settles and the UI is stuck on "Searching…" forever with no
// error and no way out. Reported live: a user's search hung indefinitely
// with zero feedback. Wrapping in an explicit timeout, same withTimeout
// pattern already used in lib/remoteSigner.ts.
const SEARCH_TIMEOUT_MS = 10000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Search timed out')), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export function SearchView() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NDKEvent[]>([])
  const [state, setState] = useState<State>('idle')
  const [errorMessage, setErrorMessage] = useState('Search failed — is the local relay running?')

  async function handleSearch() {
    const trimmed = query.trim()
    if (!trimmed || state === 'loading') return

    // Real user-reported gap (2026-08-07): there was no way to look up an
    // unfamiliar pubkey from a notification — NIP-50 search only matches
    // note *content*, so pasting a raw pubkey/npub here (not a search
    // term at all) always came back empty. Detect identity-shaped input
    // — hex, npub, or nprofile, whatever form someone happened to copy —
    // and jump straight to that profile instead of running it as a
    // (guaranteed-empty) content search.
    const pubkey = resolvePubkeyInput(trimmed)
    if (pubkey) {
      viewProfile(pubkey)
      return
    }

    // Same idea for a specific note (note1.../nevent1...) — e.g. a link
    // copied from another client while triaging /engage candidates.
    // Closes a real, previously-documented gap (see lib/navigation.ts's
    // viewNote): there was no way to open an arbitrary external note in
    // NOSTRAS at all, only profiles and articles.
    const noteRef = resolveNoteReference(trimmed)
    if (noteRef) {
      setState('loading')
      try {
        // Union of the app's own known-good relays and the nevent's own
        // relay hints (filtered) — mirrors sendDirectMessage's own
        // "union of our relays and discovered ones" approach in lib/dm.ts,
        // so a note resolves whether or not the hints turn out to be
        // useful, and never solely trusts untrusted hint data alone.
        const hintUrls = noteRef.relays.filter(isAllowedRelayUrl)
        const relaySet = NDKRelaySet.fromRelayUrls(
          Array.from(new Set([localRelayUrl, ...publicRelayUrls, ...hintUrls])),
          ndk,
        )
        const event = await ndk.fetchEvent({ ids: [noteRef.id] }, undefined, relaySet)
        if (event) {
          viewNote(event)
          setState('idle')
        } else {
          setErrorMessage("Couldn't find that note on any known relay.")
          setState('error')
        }
      } catch {
        setErrorMessage("Couldn't find that note on any known relay.")
        setState('error')
      }
      return
    }

    setState('loading')
    setErrorMessage('Search failed — is the local relay running?')
    try {
      // ONLY_RELAY: NDK's cache doesn't implement full-text search, so a
      // default/cache-aware fetch would silently blend in cached kind:1
      // events that match on structural fields (kind) but not the actual
      // search term — bypass it entirely so results only reflect the
      // relay's real NIP-50 match.
      const found = await withTimeout(
        ndk.fetchEvents(
          { kinds: [1], search: trimmed, limit: 50 },
          { cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY, closeOnEose: true },
          localRelaySet,
        ),
        SEARCH_TIMEOUT_MS,
      )
      const sorted = Array.from(found).sort(
        (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
      )
      setResults(sorted)
      setState(sorted.length > 0 ? 'results' : 'empty')
    } catch {
      setState('error')
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSearch()
  }

  return (
    <div className="search-view">
      <div className="field-row">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search notes, paste a pubkey/npub for a profile, or a note1/nevent1 link…"
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSearch}
          disabled={!query.trim() || state === 'loading'}
        >
          {state === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </div>
      <p className="field-hint">
        Nostr has no central search index — every relay only knows what's
        been published to it, so this searches notes that reached
        NOSTRAS's own relay (via NIP-50, the protocol's search extension),
        not the whole network. Your Nostr identity is a single key, just
        shown in different reversible formats — hex (raw), npub (the
        shareable form you'll usually see), nprofile (npub plus relay
        hints). Paste any of the three here to jump straight to that
        profile — or paste a note1/nevent1 link (from another client's
        "copy note link") to open that specific note directly.
      </p>

      {state === 'idle' && (
        <div className="feed-empty">
          <SearchIcon className="feed-empty-icon" />
          <p>Search notes</p>
          <p className="feed-empty-hint">Type something and hit Enter.</p>
        </div>
      )}

      {state === 'empty' && (
        <div className="feed-empty">
          <p>No results for "{query.trim()}".</p>
        </div>
      )}

      {state === 'error' && (
        <p className="alert-error">{errorMessage}</p>
      )}

      {state === 'results' && (
        <ul className="feed">
          {results.map((event) => (
            <FeedItem key={event.id} event={event} />
          ))}
        </ul>
      )}
    </div>
  )
}
