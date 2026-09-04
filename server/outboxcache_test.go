package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

func signedTestEvent(t *testing.T, sk string, kind int, content string) *nostr.Event {
	t.Helper()
	pk, err := nostr.GetPublicKey(sk)
	if err != nil {
		t.Fatal(err)
	}
	evt := &nostr.Event{
		PubKey:    pk,
		CreatedAt: nostr.Now(),
		Kind:      kind,
		Tags:      nostr.Tags{},
		Content:   content,
	}
	if err := evt.Sign(sk); err != nil {
		t.Fatal(err)
	}
	return evt
}

func TestOutboxCacheStore_TrackUntrackPersist(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "cache.json")

	s, err := newOutboxCacheStore(path)
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now().Unix()
	s.track("id-a", now)
	s.track("id-b", now-1000)
	// tracking an already-tracked id must not overwrite its original timestamp
	s.track("id-a", now+9999)

	if s.size() != 2 {
		t.Fatalf("expected 2 tracked, got %d", s.size())
	}

	s.untrack("id-a")
	if s.size() != 1 {
		t.Fatalf("expected 1 tracked after untrack, got %d", s.size())
	}

	due := s.dueForEviction(now)
	if len(due) != 1 || due[0] != "id-b" {
		t.Fatalf("expected only id-b due, got %v", due)
	}

	if err := s.evicted([]string{"id-b"}); err != nil {
		t.Fatal(err)
	}
	if s.size() != 0 {
		t.Fatalf("expected 0 tracked after eviction, got %d", s.size())
	}

	// reload from disk — evicted() must have persisted the change
	s2, err := newOutboxCacheStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if s2.size() != 0 {
		t.Fatalf("expected reloaded store to have 0 entries, got %d", s2.size())
	}
}

func TestRunOutboxCacheSweep_OnlyEvictsStaleTrackedEvents(t *testing.T) {
	ctx := context.Background()

	badgerDir := t.TempDir()
	db := badger.BadgerBackend{Path: badgerDir}
	if err := db.Init(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	relay := khatru.NewRelay()
	relay.DeleteEvent = append(relay.DeleteEvent, db.DeleteEvent)

	sk := nostr.GeneratePrivateKey()

	// A: never tracked at all — simulates a real client's own direct
	// publish that never went through the outbox path. Must survive
	// regardless of age.
	evtA := signedTestEvent(t, sk, 1, "genuinely local, never outbox-cached")
	if err := db.SaveEvent(ctx, evtA); err != nil {
		t.Fatal(err)
	}

	// B: tracked, but with a recent timestamp — still within retention.
	// Must survive.
	evtB := signedTestEvent(t, sk, 1, "outbox-cached recently")
	if err := db.SaveEvent(ctx, evtB); err != nil {
		t.Fatal(err)
	}

	// C: tracked, with a timestamp well past retention. Must be deleted.
	evtC := signedTestEvent(t, sk, 1, "outbox-cached long ago, now stale")
	if err := db.SaveEvent(ctx, evtC); err != nil {
		t.Fatal(err)
	}

	cachePath := filepath.Join(t.TempDir(), "cache.json")
	cache, err := newOutboxCacheStore(cachePath)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	cache.track(evtB.ID, now-3600)                // 1 hour ago — fresh
	cache.track(evtC.ID, now-31*24*60*60)          // 31 days ago — stale under a 30-day retention

	runOutboxCacheSweep(relay, &db, cache, 30 /* retentionDays */)

	assertExists := func(id string, wantExists bool, label string) {
		ch, err := db.QueryEvents(ctx, nostr.Filter{IDs: []string{id}})
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for range ch {
			found = true
		}
		if found != wantExists {
			t.Fatalf("%s: expected exists=%v, got exists=%v", label, wantExists, found)
		}
	}

	assertExists(evtA.ID, true, "A (never tracked)")
	assertExists(evtB.ID, true, "B (fresh, within retention)")
	assertExists(evtC.ID, false, "C (stale, past retention)")

	if cache.size() != 1 {
		t.Fatalf("expected tracking store to retain only the still-fresh entry, got size %d", cache.size())
	}
	// Check against the same 30-day retention cutoff runOutboxCacheSweep
	// itself used — evtB (tracked 1h ago) is correctly NOT due under
	// that real cutoff, even though it trivially "is due" if checked
	// against a cutoff of `now` itself (which isn't a real retention
	// window, just an artifact of any positive age).
	realCutoff := now - 30*24*60*60
	if due := cache.dueForEviction(realCutoff); len(due) != 0 {
		t.Fatalf("expected nothing due under the real 30-day retention window, got %v", due)
	}
}

func TestOutboxCacheUntrackHook_ProtectsDirectlyPublishedEvent(t *testing.T) {
	ctx := context.Background()

	badgerDir := t.TempDir()
	db := badger.BadgerBackend{Path: badgerDir}
	if err := db.Init(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	relay := khatru.NewRelay()
	relay.DeleteEvent = append(relay.DeleteEvent, db.DeleteEvent)

	sk := nostr.GeneratePrivateKey()
	evt := signedTestEvent(t, sk, 1, "outbox-cached first, then genuinely published here later")
	if err := db.SaveEvent(ctx, evt); err != nil {
		t.Fatal(err)
	}

	cachePath := filepath.Join(t.TempDir(), "cache.json")
	cache, err := newOutboxCacheStore(cachePath)
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now().Unix()
	// Simulate: this exact event was outbox-cached a long time ago...
	cache.track(evt.ID, now-60*24*60*60)

	// ...then a real client directly (re-)published it to this relay —
	// the StoreEvent hook must untrack it.
	untrack := newOutboxCacheUntrackHook(cache)
	if err := untrack(ctx, evt); err != nil {
		t.Fatal(err)
	}

	if due := cache.dueForEviction(now); len(due) != 0 {
		t.Fatalf("expected the directly-published event to be untracked, still due: %v", due)
	}

	// A sweep now must NOT delete it, even though its (stale, since-
	// removed) original tracked timestamp was long past retention.
	runOutboxCacheSweep(relay, &db, cache, 30)

	ch, err := db.QueryEvents(ctx, nostr.Filter{IDs: []string{evt.ID}})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for range ch {
		found = true
	}
	if !found {
		t.Fatal("expected the directly-published, untracked event to survive the sweep, but it was deleted")
	}

	if err := os.Remove(cachePath); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
}
