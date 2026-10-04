package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/fiatjaf/eventstore"
	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

// outboxCacheStore tracks which events reached this relay's own badger
// store ONLY via NIP-65 outbox aggregation (see outbox.go), never via a
// real client directly publishing to this relay — so they can be safely
// aged out later without ever touching this relay's own real data.
//
// Root cause this exists to fix (2026-09-04, see NOSTRAS-CSV.md's
// PQ-067/PQ-069): sys.FetchFeedPage (outbox.go's newAggregatedQuery)
// writes every fetched foreign author's events into the SAME badger
// store this relay's own directly-published events live in, as a
// deliberate "so repeat queries get cheaper" cache — but with no TTL, no
// eviction, no size bound anywhere in the code. A live production heap
// profile confirmed this — not this project's own comparatively small
// real user base — as the dominant driver of this relay's recurring
// "the store outgrew the machine" capacity incidents.
//
// The safety property that makes this store correct: outbox.go's own
// local pre-query (db.QueryEvents against the same filter, run before
// the outbox fetch) already computes exactly the distinction needed here
// — an event already present locally, for ANY reason including a
// genuine direct publish, is marked "seen" and is never forwarded (or
// tracked) as a fresh outbox addition. track() is only ever called for
// events outbox.go has just confirmed are new-to-local-store. untrack()
// (wired to relay.StoreEvent) additionally removes an id the moment a
// real client directly (re-)publishes that exact event, so even the
// narrow edge case of "outbox-cached first, genuinely published here
// later" can't accidentally get swept — untracked means "never evict."
type outboxCacheStore struct {
	mu    sync.Mutex
	path  string
	data  map[string]int64 // event id -> unix time first cached via outbox
	dirty bool
}

func newOutboxCacheStore(path string) (*outboxCacheStore, error) {
	s := &outboxCacheStore{path: path, data: map[string]int64{}}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &s.data); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *outboxCacheStore) saveLocked() error {
	raw, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	if err := os.WriteFile(s.path, raw, 0600); err != nil {
		return err
	}
	s.dirty = false
	return nil
}

// track records that eventID was just newly cached locally via outbox
// aggregation. In-memory only — persistence is batched (see
// flushIfDirty), not synchronous per call, since this runs on a hot-ish
// per-query path and this project has already been burned once (the
// push-notification lock-contention outage) by a synchronous disk write
// on a frequently-hit hook.
func (s *outboxCacheStore) track(eventID string, now int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.data[eventID]; !exists {
		s.data[eventID] = now
		s.dirty = true
	}
}

// untrack removes an id from the eviction-candidate set — called
// whenever a real client directly publishes that exact event to this
// relay, so genuinely local content can never be aged out just because
// it also happened to pass through the outbox cache at some point.
func (s *outboxCacheStore) untrack(eventID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.data[eventID]; exists {
		delete(s.data, eventID)
		s.dirty = true
	}
}

// dueForEviction returns every tracked id whose first-cached time is
// older than the cutoff.
func (s *outboxCacheStore) dueForEviction(cutoff int64) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	due := make([]string, 0)
	for id, cachedAt := range s.data {
		if cachedAt < cutoff {
			due = append(due, id)
		}
	}
	return due
}

// evicted drops the given ids from tracking (whether or not they were
// actually found and deleted in badger — an id that's already gone by
// some other route, e.g. a NIP-09 delete, has nothing left to evict but
// still shouldn't be tracked forever) and persists once for the whole
// batch, not once per id.
func (s *outboxCacheStore) evicted(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, id := range ids {
		delete(s.data, id)
	}
	s.dirty = true
	return s.saveLocked()
}

func (s *outboxCacheStore) flushIfDirty() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.dirty {
		return nil
	}
	return s.saveLocked()
}

// isTracked reports whether an event reached the store only via outbox
// aggregation (used by the search-index rebuild to skip it).
func (s *outboxCacheStore) isTracked(eventID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.data[eventID]
	return ok
}

func (s *outboxCacheStore) size() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.data)
}

// newOutboxCacheUntrackHook returns a StoreEvent hook that removes an
// event from the eviction-candidate set the instant a real client
// directly publishes it to this relay — see outboxCacheStore's own doc
// comment for why this matters.
func newOutboxCacheUntrackHook(store *outboxCacheStore) func(ctx context.Context, evt *nostr.Event) error {
	return func(_ context.Context, evt *nostr.Event) error {
		store.untrack(evt.ID)
		return nil
	}
}

const outboxCacheSweepInterval = 6 * time.Hour
const outboxCacheFlushInterval = 5 * time.Minute

// startOutboxCacheSweeper runs the periodic eviction sweep and the
// periodic tracking-file flush in the background. Deliberately delays
// its first sweep by 10 minutes past boot — badger is already doing real
// work (table reopen/compaction) right after startup, no reason to add
// sweep load on top of that window.
func startOutboxCacheSweeper(relay *khatru.Relay, db *badger.BadgerBackend, store *outboxCacheStore, retentionDays int) {
	go func() {
		time.Sleep(10 * time.Minute)
		for {
			runOutboxCacheSweep(relay, db, store, retentionDays)
			time.Sleep(outboxCacheSweepInterval)
		}
	}()
	go func() {
		for {
			time.Sleep(outboxCacheFlushInterval)
			if err := store.flushIfDirty(); err != nil {
				fmt.Println("outbox cache: flush failed:", err)
			}
		}
	}()
}

// runOutboxCacheSweep deletes every outbox-cached event past the
// retention window from badger, reusing relay.DeleteEvent's existing
// hook chain — the same delete path NIP-09/NIP-62/NIP-86 already use, so
// search-index cleanup isn't a separate thing to remember (though in
// practice outbox-cached events were never search-indexed to begin with;
// see outbox.go's comment on why that write path bypasses
// relay.StoreEvent entirely). DeleteEvent needs the FULL event, not just
// an id (getIndexKeysForEvent needs the real kind/pubkey/created_at/tags
// to compute which index keys to remove), so this re-fetches by id
// before deleting rather than trying to delete from the id alone.
func runOutboxCacheSweep(relay *khatru.Relay, db *badger.BadgerBackend, store *outboxCacheStore, retentionDays int) {
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour).Unix()
	due := store.dueForEviction(cutoff)
	if len(due) == 0 {
		return
	}

	bg := context.Background()
	deleted := 0

	const batchSize = 200
	for i := 0; i < len(due); i += batchSize {
		end := i + batchSize
		if end > len(due) {
			end = len(due)
		}
		batch := due[i:end]

		ch, err := db.QueryEvents(bg, nostr.Filter{IDs: batch})
		if err != nil {
			fmt.Println("outbox cache sweep: query failed:", err)
			continue
		}
		for target := range ch {
			for _, del := range relay.DeleteEvent {
				if err := del(bg, target); err != nil {
					fmt.Println("outbox cache sweep: delete failed:", err)
				}
			}
			deleted++
		}
		// Pace large sweeps (the one after the pre-launch backfill
		// below covers hundreds of thousands of events) so deletes
		// don't monopolize badger while live traffic is served.
		time.Sleep(20 * time.Millisecond)
	}

	if err := store.evicted(due); err != nil {
		fmt.Println("outbox cache sweep: could not persist tracking file:", err)
	}

	fmt.Printf("outbox cache sweep: evicted %d/%d stale outbox-cached events (still tracking %d)\n",
		deleted, len(due), store.size())
}

// outboxTrackingStore is the store handed to the go-nostr SDK
// (sdk.WithStore). The SDK saves every event it fetches into its store,
// not just the ones FetchFeedPage returns: events at or after the query's
// `until` are stored but not returned, a FetchFeedPage that hits its
// timeout has already stored whatever arrived before erroring (and
// outbox.go then tracks nothing), and relay-list lookups (kind:10002) are
// stored too. Tracking only what outbox.go returns therefore missed most
// of the cache: a storage scan (2026-10-03) found 3.96GB of the 4.56GB
// store untracked, from 412k distinct authors, so the 30-day sweeper
// never saw it (PQ-093 follow-up).
//
// Tracking at the store boundary catches every SDK write, whatever path
// it came through. Client publishes never pass through here (they go via
// relay.StoreEvent straight to db), and an event that already exists
// locally is never tracked, so genuinely local data can't be marked for
// eviction.
type outboxTrackingStore struct {
	eventstore.Store
	db    *badger.BadgerBackend
	cache *outboxCacheStore
}

func newOutboxTrackingStore(db *badger.BadgerBackend, cache *outboxCacheStore) *outboxTrackingStore {
	return &outboxTrackingStore{Store: db, db: db, cache: cache}
}

func (s *outboxTrackingStore) has(ctx context.Context, id string) bool {
	ch, err := s.db.QueryEvents(ctx, nostr.Filter{IDs: []string{id}})
	if err != nil {
		return false
	}
	found := false
	for range ch {
		found = true
	}
	return found
}

func (s *outboxTrackingStore) SaveEvent(ctx context.Context, evt *nostr.Event) error {
	if s.has(ctx, evt.ID) {
		return s.Store.SaveEvent(ctx, evt)
	}
	err := s.Store.SaveEvent(ctx, evt)
	if err == nil {
		s.cache.track(evt.ID, int64(nostr.Now()))
	}
	return err
}

// ReplaceEvent can be a no-op (an older version than what's stored), so
// only track when the event is actually present afterwards.
func (s *outboxTrackingStore) ReplaceEvent(ctx context.Context, evt *nostr.Event) error {
	existed := s.has(ctx, evt.ID)
	err := s.Store.ReplaceEvent(ctx, evt)
	if err == nil && !existed && s.has(ctx, evt.ID) {
		s.cache.track(evt.ID, int64(nostr.Now()))
	}
	return err
}

// Pre-launch backfill (2026-10-04, PQ-093 follow-up). Until a162a94 most
// SDK-cached events were never tracked, so the sweeper never evicted
// them: a storage scan found 3.96GB of the 4.56GB store untracked. After
// the fact an untracked cached copy can't always be told apart from a
// genuine direct publish, but anything created before this relay existed
// can't have been published to it by its author. Every untracked event
// created before outboxBackfillCutoff is therefore marked as cache, with
// the current time as its cached-at, so the normal retention window
// applies before it's evicted (and the marking can still be undone in
// that window). Events created on or after the cutoff are left alone.
// Runs once; a marker file next to the tracking file records completion,
// and an interrupted run simply runs again on the next boot.
const outboxBackfillCutoff = 1785542400 // 2026-08-01T00:00:00Z
const outboxBackfillVersion = "1"

func outboxBackfillMarkerPath(trackingPath string) string {
	return trackingPath + ".backfill"
}

func startOutboxBackfill(db *badger.BadgerBackend, store *outboxCacheStore, trackingPath string) {
	marker := outboxBackfillMarkerPath(trackingPath)
	if raw, err := os.ReadFile(marker); err == nil && strings.TrimSpace(string(raw)) == outboxBackfillVersion {
		return
	}
	go func() {
		// Let boot-time badger work settle first, as the sweeper does.
		time.Sleep(2 * time.Minute)
		marked, scanned := runOutboxBackfill(context.Background(), db, store, outboxBackfillCutoff)
		if err := store.flushIfDirty(); err != nil {
			fmt.Println("outbox backfill: flush failed, will rerun next boot:", err)
			return
		}
		if err := os.WriteFile(marker, []byte(outboxBackfillVersion+"\n"), 0600); err != nil {
			fmt.Println("outbox backfill: could not write marker:", err)
		}
		fmt.Printf("outbox backfill: scanned %d events, marked %d created before 2026-08-01 as cache (now tracking %d)\n",
			scanned, marked, store.size())
	}()
}

// runOutboxBackfill marks every untracked event created before cutoff.
// Paced like the storage scan so it doesn't starve live queries.
func runOutboxBackfill(ctx context.Context, db *badger.BadgerBackend, store *outboxCacheStore, cutoff int64) (marked, scanned int) {
	now := int64(nostr.Now())
	db.ScanRawEvents(ctx, 5000, func(evt *nostr.Event, _ int) bool {
		scanned++
		if int64(evt.CreatedAt) < cutoff && !store.isTracked(evt.ID) {
			store.track(evt.ID, now)
			marked++
		}
		if scanned%5000 == 0 {
			time.Sleep(20 * time.Millisecond)
		}
		return true
	})
	return marked, scanned
}
