package main

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/fiatjaf/eventstore"
	"github.com/fiatjaf/eventstore/badger"
	"github.com/nbd-wtf/go-nostr"
)

// ScanRawEvents walks the store in chunks, each in its own read txn; the
// chunk boundary (seek to the last key, skip it) is where an off-by-one
// would drop or double-count an event. Chunk sizes that divide the total
// evenly, don't, and exceed it are all checked.
func TestScanRawEventsChunking(t *testing.T) {
	db := &badger.BadgerBackend{Path: t.TempDir()}
	if err := db.Init(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	sk := nostr.GeneratePrivateKey()
	const n = 23
	want := map[string]bool{}
	for i := 0; i < n; i++ {
		evt := nostr.Event{Kind: 1, Content: fmt.Sprintf("event %d", i), CreatedAt: nostr.Timestamp(1700000000 + i)}
		if err := evt.Sign(sk); err != nil {
			t.Fatal(err)
		}
		if err := db.SaveEvent(context.Background(), &evt); err != nil {
			t.Fatal(err)
		}
		want[evt.ID] = true
	}

	for _, chunk := range []int{1, 2, 5, 23, 100} {
		got := map[string]int{}
		err := db.ScanRawEvents(context.Background(), chunk, func(evt *nostr.Event, size int) bool {
			if size <= 0 {
				t.Errorf("chunk %d: non-positive size for %s", chunk, evt.ID)
			}
			got[evt.ID]++
			return true
		})
		if err != nil {
			t.Fatalf("chunk %d: %v", chunk, err)
		}
		if len(got) != n {
			t.Errorf("chunk %d: saw %d distinct events, want %d", chunk, len(got), n)
		}
		for id, c := range got {
			if !want[id] {
				t.Errorf("chunk %d: unexpected id %s", chunk, id)
			}
			if c != 1 {
				t.Errorf("chunk %d: id %s seen %d times", chunk, id, c)
			}
		}
	}

	// Early stop is honored.
	seen := 0
	_ = db.ScanRawEvents(context.Background(), 4, func(*nostr.Event, int) bool {
		seen++
		return seen < 7
	})
	if seen != 7 {
		t.Errorf("early stop: saw %d, want 7", seen)
	}
}

// The scanner splits outbox-cached vs direct correctly and finishes.
func TestStorageScannerSplit(t *testing.T) {
	db := &badger.BadgerBackend{Path: t.TempDir()}
	if err := db.Init(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cache, err := newOutboxCacheStore(t.TempDir() + "/oc.json")
	if err != nil {
		t.Fatal(err)
	}

	sk := nostr.GeneratePrivateKey()
	for i := 0; i < 10; i++ {
		kind := 1
		if i%2 == 0 {
			kind = 1059
		}
		evt := nostr.Event{Kind: kind, Content: fmt.Sprintf("x%d", i), CreatedAt: nostr.Now()}
		evt.Sign(sk)
		db.SaveEvent(context.Background(), &evt)
		if i < 3 {
			cache.track(evt.ID, int64(nostr.Now()))
		}
	}

	s := newStorageScanner(db, cache)
	s.run()
	r := s.snapshot()
	if r.Running || r.Total.Count != 10 || r.Total.OutboxCount != 3 {
		t.Fatalf("got running=%v total=%d outbox=%d, want false/10/3", r.Running, r.Total.Count, r.Total.OutboxCount)
	}
	if r.Age["under1d"].Count != 10 {
		t.Errorf("age under1d = %d, want 10", r.Age["under1d"].Count)
	}
	if len(r.Kinds) != 2 || r.DistinctDirectAuthors != 1 || len(r.TopDirectAuthors) != 1 || r.TopDirectAuthors[0].Count != 7 {
		t.Errorf("unexpected breakdown: kinds=%d directAuthors=%d top=%+v", len(r.Kinds), r.DistinctDirectAuthors, r.TopDirectAuthors)
	}
}

// Every event the SDK caches must be tracked for eviction, but an event
// already stored (e.g. a real client's direct publish) must never be.
// Driven through eventstore.RelayWrapper.Publish, the exact call the SDK
// makes for every event it fetches.
func TestOutboxTrackingStore(t *testing.T) {
	db := &badger.BadgerBackend{Path: t.TempDir()}
	if err := db.Init(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cache, _ := newOutboxCacheStore(t.TempDir() + "/oc.json")
	w := eventstore.RelayWrapper{Store: newOutboxTrackingStore(db, cache)}
	ctx := context.Background()
	sk := nostr.GeneratePrivateKey()
	mk := func(kind int, content string, ts int64) nostr.Event {
		e := nostr.Event{Kind: kind, Content: content, CreatedAt: nostr.Timestamp(ts)}
		e.Sign(sk)
		return e
	}

	// 1. New regular event fetched by the SDK: tracked.
	fetched := mk(1, "fetched", 1700000000)
	w.Publish(ctx, fetched)
	if !cache.isTracked(fetched.ID) {
		t.Error("new SDK-fetched event not tracked")
	}

	// 2. Event a client already published directly: SDK re-fetch must not track it.
	direct := mk(1, "direct", 1700000001)
	db.SaveEvent(ctx, &direct)
	w.Publish(ctx, direct)
	if cache.isTracked(direct.ID) {
		t.Error("pre-existing direct event got tracked")
	}

	// 3. Newer replaceable (kind 10002) fetched by the SDK: tracked.
	oldList := mk(10002, "", 1700000100)
	db.SaveEvent(ctx, &oldList)
	newList := mk(10002, "", 1700000200)
	w.Publish(ctx, newList)
	if !cache.isTracked(newList.ID) {
		t.Error("newer replaceable from SDK not tracked")
	}

	// 4. Older replaceable than what's stored: replace is a no-op, not tracked.
	older := mk(10002, "", 1700000150)
	w.Publish(ctx, older)
	if cache.isTracked(older.ID) {
		t.Error("stale replaceable that wasn't stored got tracked")
	}
}

// Pre-launch backfill: untracked events older than the cutoff become
// cache; newer events are never touched; already-tracked events keep
// their original cached-at; the marker file stops a second run.
func TestOutboxBackfill(t *testing.T) {
	db := &badger.BadgerBackend{Path: t.TempDir()}
	if err := db.Init(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	dir := t.TempDir()
	cache, _ := newOutboxCacheStore(dir + "/oc.json")
	ctx := context.Background()
	sk := nostr.GeneratePrivateKey()
	save := func(content string, ts int64) nostr.Event {
		e := nostr.Event{Kind: 1, Content: content, CreatedAt: nostr.Timestamp(ts)}
		e.Sign(sk)
		db.SaveEvent(ctx, &e)
		return e
	}
	const cutoff = 1785542400
	oldA := save("old a", cutoff-86400*400)
	oldB := save("old b", cutoff-1)
	atCutoff := save("at cutoff", cutoff)
	recent := save("recent", cutoff+86400*30)
	oldTracked := save("old tracked", cutoff-100)
	cache.track(oldTracked.ID, 12345)

	marked, scanned := runOutboxBackfill(ctx, db, cache, cutoff)
	if scanned != 5 || marked != 2 {
		t.Fatalf("scanned=%d marked=%d, want 5 and 2", scanned, marked)
	}
	for _, e := range []nostr.Event{oldA, oldB} {
		if !cache.isTracked(e.ID) {
			t.Errorf("%q not marked", e.Content)
		}
	}
	for _, e := range []nostr.Event{atCutoff, recent} {
		if cache.isTracked(e.ID) {
			t.Errorf("%q marked, but it's not before the cutoff", e.Content)
		}
	}
	cache.mu.Lock()
	kept := cache.data[oldTracked.ID]
	cache.mu.Unlock()
	if kept != 12345 {
		t.Errorf("already-tracked cached-at changed to %d", kept)
	}

	// Marker present: startOutboxBackfill must not schedule anything.
	os.WriteFile(outboxBackfillMarkerPath(dir+"/oc.json"), []byte(outboxBackfillVersion+"\n"), 0600)
	before := cache.size()
	startOutboxBackfill(db, cache, dir+"/oc.json") // returns immediately
	if cache.size() != before {
		t.Error("backfill ran despite marker")
	}
}
