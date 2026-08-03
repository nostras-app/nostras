package main

import (
	"context"

	"github.com/fiatjaf/eventstore/bluge"
	"github.com/nbd-wtf/go-nostr"
)

// newSearchAwareQuery returns a khatru QueryEvents function implementing
// NIP-50: any REQ filter with a non-empty Search field is routed to the
// bluge full-text index instead of the normal query path. Bluge only
// stores event IDs; it fetches the actual events from search.RawEventStore
// (our badger backend) once it knows which IDs match.
//
// Search currently only covers events published directly to this relay —
// events pulled in via NIP-65 outbox aggregation (server/outbox.go) aren't
// indexed yet, since that path writes to the store directly rather than
// through khatru's StoreEvent hooks. Fine for now, worth revisiting.
func newSearchAwareQuery(
	search *bluge.BlugeBackend,
	next func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error),
) func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
	return func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
		if filter.Search == "" {
			return next(ctx, filter)
		}
		return search.QueryEvents(ctx, filter)
	}
}
