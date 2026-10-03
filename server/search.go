package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fiatjaf/eventstore/badger"
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

// searchableKinds is the only set of kinds the search index stores. It
// mirrors SEARCH_KINDS in client/src/components/SearchView.tsx: notes,
// articles, zap goals, polls, forum threads, podcast episodes.
//
// Before 2026-10-03 every event stored directly on this relay was
// full-text indexed regardless of kind, including NIP-17 gift wraps,
// NIP-04 DMs, other apps' kind:30078 data and DVM job traffic. Most of
// that is ciphertext or JSON, which nobody can usefully search and which
// floods the term dictionary with unique junk tokens. That's how the
// index reached 4.8GB, nearly the size of the event store itself, and
// was a large part of the third disk-full outage (PQ-093).
var searchableKinds = map[int]bool{
	1:     true, // note
	30023: true, // NIP-23 article
	9041:  true, // NIP-75 zap goal
	1068:  true, // NIP-88 poll
	11:    true, // NIP-7D forum thread
	54:    true, // NIP-F4 podcast episode
}

// isSearchable reports whether an event belongs in the search index. A
// paid article/episode (["encrypted"] tag) carries ciphertext as its
// content, so it's excluded for the same reason as DMs.
func isSearchable(evt *nostr.Event) bool {
	return searchableKinds[evt.Kind] && !hasTag(evt, "encrypted")
}

// searchIndexVersion is bumped whenever what goes into the index changes
// in a way that needs existing segments thrown away. Version 2 = the
// searchableKinds allowlist above.
const searchIndexVersion = "2"

func searchIndexMarkerPath(blugePath string) string {
	return filepath.Clean(blugePath) + ".version"
}

// prepareSearchIndex runs before the bluge writer opens. If the on-disk
// index predates the current searchIndexVersion it's deleted outright
// (bluge has no cheap "drop every doc of kind X" operation; rebuilding
// from badger is simpler and also reclaims the space immediately).
// Returns true when the caller must run rebuildSearchIndex once the rest
// of the relay is wired up. The marker is written only after a rebuild
// finishes, so a crash mid-rebuild redoes it on the next boot.
func prepareSearchIndex(blugePath string) (needsRebuild bool, err error) {
	raw, err := os.ReadFile(searchIndexMarkerPath(blugePath))
	if err == nil && strings.TrimSpace(string(raw)) == searchIndexVersion {
		return false, nil
	}
	if err := os.RemoveAll(blugePath); err != nil {
		return false, err
	}
	return true, nil
}

// rebuildSearchIndex walks badger newest-first, one page of searchable
// kinds at a time, and feeds each event through the same index hook live
// writes use (so group-chat and encrypted exclusions apply identically).
// Outbox-cached events are skipped: they never went through StoreEvent,
// so they were never indexed before either. Paced with a short sleep per
// page so it doesn't starve live queries on the same badger store.
func rebuildSearchIndex(
	db *badger.BadgerBackend,
	index func(ctx context.Context, evt *nostr.Event) error,
	outboxCache *outboxCacheStore,
	blugePath string,
) {
	go func() {
		ctx := context.Background()
		kinds := make([]int, 0, len(searchableKinds))
		for k := range searchableKinds {
			kinds = append(kinds, k)
		}

		start := time.Now()
		until := nostr.Now() + 3600
		seen := map[string]bool{}
		indexed, skipped := 0, 0
		for {
			u := until
			ch, err := db.QueryEvents(ctx, nostr.Filter{Kinds: kinds, Until: &u, Limit: maxFilterLimit})
			if err != nil {
				fmt.Println("search index rebuild: query failed, will retry next boot:", err)
				return
			}
			fresh := 0
			oldest := until
			for evt := range ch {
				if seen[evt.ID] {
					continue
				}
				seen[evt.ID] = true
				fresh++
				if evt.CreatedAt < oldest {
					oldest = evt.CreatedAt
				}
				if outboxCache != nil && outboxCache.isTracked(evt.ID) {
					skipped++
					continue
				}
				if err := index(ctx, evt); err != nil {
					fmt.Println("search index rebuild: index failed, will retry next boot:", err)
					return
				}
				indexed++
			}
			if fresh == 0 || oldest == 0 {
				break
			}
			if oldest < until {
				until = oldest
			} else {
				// A whole page shared one created_at second. Step past it
				// rather than loop forever (may miss a few same-second
				// events, which is acceptable for a search index).
				until = oldest - 1
			}
			// Bound the dedupe map: anything older than the current page
			// can't come back.
			if len(seen) > 20000 {
				seen = map[string]bool{}
			}
			time.Sleep(50 * time.Millisecond)
		}

		if err := os.WriteFile(searchIndexMarkerPath(blugePath), []byte(searchIndexVersion+"\n"), 0600); err != nil {
			fmt.Println("search index rebuild: could not write version marker:", err)
		}
		fmt.Printf("search index rebuild: done in %s, processed %d events, skipped %d outbox-cached\n",
			time.Since(start).Round(time.Second), indexed, skipped)
	}()
}
