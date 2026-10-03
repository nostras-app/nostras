package main

import (
	"context"
	"fmt"
	"testing"

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
