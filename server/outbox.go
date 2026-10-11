package main

import (
	"context"
	"time"

	"github.com/fiatjaf/eventstore"
	"github.com/fiatjaf/eventstore/badger"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/sdk"
)

// Real production incident (2026-08-06): sys.FetchFeedPage (go-nostr's
// own SDK) processes authors sequentially, one real network round-trip at
// a time, with no timeout of its own. A query for a user following many
// accounts, several needing a fresh outbox lookup against a popular
// public relay (nos.lol, in the actual incident), can run uninterrupted
// for a very long time. Under real concurrent traffic this piled up
// enough blocked goroutines to starve the relay's ability to even accept
// new WebSocket connections — confirmed live: plain kind-only queries
// worked fine, but an authors-filtered query (the only kind that reaches
// this code path) reliably failed the handshake itself. Bounding this
// call is the fix, same category as the earlier broadcast-path fix
// (WriteJSONWithDeadline) — degrade to whatever's already fetched rather
// than block indefinitely.
const outboxFetchTimeout = 8 * time.Second

// Bounding concurrency (2026-08-06, continued, then reworked 2026-10-04).
// The first bound was a semaphore of 6 whole FetchFeedPage calls. That
// stalled outbox aggregation entirely in production: FetchFeedPage walks
// a query's authors one at a time, and the SDK pool's EnsureRelay dials
// with its own 15s timeout under a hashed lock, ignoring our context. So
// after the 8s timeout fired, a call kept working through every remaining
// author, one dial at a time, holding its slot for many minutes.
// Goroutine dumps (2026-10-02 and 2026-10-04) showed all 6 slots held
// this way, and later author queries got local results only (PQ-093
// follow-up).
//
// Now each author is fetched by its own single-author FetchFeedPage call,
// under a shared limit of concurrent author fetches. A query stops
// launching authors and returns at its deadline; calls still in flight
// finish in the background (whatever they fetch is still cached and
// tracked) and release their slot when done. A single-author call is
// short (a relay-list lookup plus at most one dial), so abandoned work
// clears in seconds instead of minutes.
const maxConcurrentAuthorFetches = 12

var authorFetchSem = make(chan struct{}, maxConcurrentAuthorFetches)

// Queries naming more authors than this skip outbox aggregation and get
// local results only. Fanning out to hundreds of authors can't finish
// within outboxFetchTimeout anyway, and clients asking for large author
// lists (a Following feed) also query public relays themselves.
const maxOutboxAuthors = 20

// authorFetcher fetches up to `limit` events by one author. In production
// it's newOutboxAuthorFetcher (outboxfetch.go); tests substitute fakes.
type authorFetcher func(ctx context.Context, pubkey string, limit int) []*nostr.Event

// fetchOutboxAuthors fetches each author in parallel (bounded by sem) and
// returns whatever arrived before ctx's deadline. It never waits past the
// deadline: workers still running are left to finish on their own, and
// their result channel is buffered so they never block on send.
func fetchOutboxAuthors(ctx context.Context, sem chan struct{}, authors []string, perAuthor int, fetch authorFetcher) []*nostr.Event {
	results := make(chan []*nostr.Event, len(authors))
	launched := 0
launch:
	for _, pk := range authors {
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
			break launch
		}
		launched++
		go func(pk string) {
			defer func() { <-sem }()
			results <- fetch(ctx, pk, perAuthor)
		}(pk)
	}

	var out []*nostr.Event
	for i := 0; i < launched; i++ {
		select {
		case evs := <-results:
			out = append(out, evs...)
		case <-ctx.Done():
			return out
		}
	}
	return out
}

// newAggregatedQuery returns a khatru QueryEvents function that implements
// the NIP-65 outbox model: for filters scoped to specific authors, it
// queries our local store AND fans the same query out to each author's
// declared write relays (per their kind:10002 event), so a client only
// ever needs this one connection to get a complete, properly-sourced feed
// instead of connecting to every relay each followed user posts to.
//
// Events fetched from outbox relays get written into the local store as a
// side effect (via sdk.System), so repeat queries get progressively faster
// and cheaper. Filters with no Authors (e.g. a straight kind/tag lookup)
// skip aggregation entirely and just hit the local store.
//
// Real, serious bug found and fixed while building NIP-58 (2026-08-15),
// not hypothetical: sys.FetchFeedPage only accepts (authors, kinds, until,
// limit) — it has no way to honor a filter's Tags constraint at all, so
// any Authors+Tags filter silently got outbox-"aggregated" results that
// ignore the Tags entirely. This is exactly the filter shape khatru's own
// manual-replace logic (internal/khatrufork/adding.go) uses to find "the
// existing addressable event to delete" before storing a new one — Kinds
// + Authors + Tags:{"d":[...]}. Reproduced directly: publishing a second
// kind:30009 badge definition with a different `d` tag caused the FIRST
// one to be silently deleted, because FetchFeedPage's own fallback
// (consulting the same local store via sdk.WithStore) returned it as a
// false match for a query that should have been scoped to the new `d`
// value alone. The same gap would just as easily corrupt a real client
// REQ combining Authors with any tag filter (e.g. "my own reactions to
// this specific note"), not just this relay's own internal delete-lookup
// — skipping aggregation whenever Tags is present is the only generally
// safe fix, not a badges-specific patch, since FetchFeedPage structurally
// cannot honor a tag constraint regardless of which caller sent it.
// Eviction tracking happens only in trackingStore (outboxTrackingStore),
// which marks an event as cache only if it wasn't already stored. This
// function used to also mark every fetched event missing from its own
// local result page as cache. That page is limited, so posts users had
// published directly to this relay but that fell outside the page got
// marked and later deleted by the 30-day sweep (2026-10-11: every NOSTRAS
// post by the operator from before 2026-09-09 was lost this way).
func newAggregatedQuery(
	db *badger.BadgerBackend,
	sys *sdk.System,
	relays *outboxRelays,
	trackingStore eventstore.Store,
) func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
	return func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
		if len(filter.Authors) == 0 || len(filter.Tags) > 0 {
			return db.QueryEvents(ctx, filter)
		}

		out := make(chan *nostr.Event)

		go func() {
			defer close(out)

			seen := make(map[string]bool)

			local, err := db.QueryEvents(ctx, filter)
			if err == nil {
				for evt := range local {
					seen[evt.ID] = true
					select {
					case out <- evt:
					case <-ctx.Done():
						return
					}
				}
			}

			until := nostr.Now()
			if filter.Until != nil {
				until = *filter.Until
			}
			limit := filter.Limit
			if limit == 0 {
				limit = 50
			}

			if len(filter.Authors) > maxOutboxAuthors {
				return
			}
			perAuthor := sdk.PerQueryLimitInBatch(limit, len(filter.Authors))
			fetchCtx, cancel := context.WithTimeout(ctx, outboxFetchTimeout)
			fetched := fetchOutboxAuthors(fetchCtx, authorFetchSem, filter.Authors, perAuthor,
				newOutboxAuthorFetcher(sys, relays, trackingStore, filter.Kinds, until))
			cancel()
			for _, evt := range fetched {
				if seen[evt.ID] {
					continue
				}
				seen[evt.ID] = true
				select {
				case out <- evt:
				case <-ctx.Done():
					return
				}
			}
		}()

		return out, nil
	}
}
