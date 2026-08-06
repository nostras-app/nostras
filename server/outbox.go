package main

import (
	"context"
	"time"

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
func newAggregatedQuery(
	db *badger.BadgerBackend,
	sys *sdk.System,
) func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
	return func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
		if len(filter.Authors) == 0 {
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

			fetchCtx, cancel := context.WithTimeout(ctx, outboxFetchTimeout)
			fetched, err := sys.FetchFeedPage(fetchCtx, filter.Authors, filter.Kinds, until, limit)
			cancel()
			if err != nil {
				// Includes a timeout: the client still got whatever
				// local results were already streamed above, just not
				// the outbox-fetched ones for this query. Better than
				// blocking the whole request indefinitely.
				return
			}
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
