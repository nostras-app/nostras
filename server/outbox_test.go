package main

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

func fakeEvents(pk string, n int) []*nostr.Event {
	out := make([]*nostr.Event, n)
	for i := range out {
		out[i] = &nostr.Event{ID: pk + string(rune('a'+i)), PubKey: pk}
	}
	return out
}

// Fast authors are all collected; nothing waits past the deadline.
func TestFetchOutboxAuthorsCollectsAll(t *testing.T) {
	sem := make(chan struct{}, 3)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	authors := []string{"a", "b", "c", "d", "e", "f", "g"}
	got := fetchOutboxAuthors(ctx, sem, authors, 2, func(ctx context.Context, pk string, limit int) []*nostr.Event {
		time.Sleep(10 * time.Millisecond)
		return fakeEvents(pk, limit)
	})
	if len(got) != len(authors)*2 {
		t.Fatalf("got %d events, want %d", len(got), len(authors)*2)
	}
	if len(sem) != 0 {
		t.Errorf("%d slots still held after all fetches returned", len(sem))
	}
}

// The production failure: some fetches hang (an EnsureRelay dial that
// ignores our context). The query must return at its deadline with what
// the fast authors produced, and the hung workers must release their
// slots once they finally return, not hold them forever.
func TestFetchOutboxAuthorsHungFetchDoesNotStall(t *testing.T) {
	sem := make(chan struct{}, 4)
	release := make(chan struct{})
	var finished atomic.Int32
	fetch := func(ctx context.Context, pk string, limit int) []*nostr.Event {
		defer finished.Add(1)
		if pk == "slow1" || pk == "slow2" {
			<-release // ignores ctx, like the SDK's dial
			return nil
		}
		return fakeEvents(pk, 1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	got := fetchOutboxAuthors(ctx, sem, []string{"slow1", "fast1", "slow2", "fast2"}, 1, fetch)
	if d := time.Since(start); d > 400*time.Millisecond {
		t.Fatalf("query took %s, should return at its ~200ms deadline", d)
	}
	if len(got) != 2 {
		t.Errorf("got %d events, want the 2 fast ones", len(got))
	}

	// Hung workers still hold 2 slots; a second query can still use the other 2.
	if len(sem) != 2 {
		t.Errorf("slots held = %d, want 2 (the hung workers)", len(sem))
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel2()
	if got2 := fetchOutboxAuthors(ctx2, sem, []string{"fast3", "fast4"}, 1, fetch); len(got2) != 2 {
		t.Errorf("second query got %d, want 2 while hung workers hold other slots", len(got2))
	}

	// Once the hung fetches return, every slot is released.
	close(release)
	deadline := time.Now().Add(time.Second)
	for len(sem) != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if len(sem) != 0 {
		t.Errorf("%d slots still held after hung fetches returned", len(sem))
	}
}

// When every slot is taken, a query doesn't wait past its deadline to
// launch; it returns empty and leaves nothing behind.
func TestFetchOutboxAuthorsSaturated(t *testing.T) {
	sem := make(chan struct{}, 1)
	sem <- struct{}{} // all slots busy
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	called := false
	got := fetchOutboxAuthors(ctx, sem, []string{"a"}, 1, func(context.Context, string, int) []*nostr.Event {
		called = true
		return nil
	})
	if called || len(got) != 0 {
		t.Errorf("fetch ran or returned events while saturated")
	}
	<-sem
}

func addrEvent(id string, kind int, d string, at nostr.Timestamp) *nostr.Event {
	evt := &nostr.Event{ID: id, PubKey: "pk", Kind: kind, CreatedAt: at}
	if d != "" {
		evt.Tags = nostr.Tags{{"d", d}}
	}
	return evt
}

// An outbox relay still holding an older version of an addressable or
// replaceable event must not get it passed through next to the newer one
// (2026-10-24, a kind:30617 announcement returned twice).
func TestDropSupersededVersions(t *testing.T) {
	localRepo := addrEvent("new", 30617, "nostras", 200)
	sent := map[string]*nostr.Event{}
	addr, _ := replaceableAddress(localRepo)
	sent[addr] = localRepo

	fetched := []*nostr.Event{
		addrEvent("old", 30617, "nostras", 100),   // stale copy of a sent version
		addrEvent("note1", 1, "", 50),             // regular event
		addrEvent("p1", 0, "", 10),                // two kind:0 versions,
		addrEvent("p2", 0, "", 20),                // only the newer one stays
		addrEvent("badgeA", 30009, "a", 10),       // different d values are
		addrEvent("badgeB", 30009, "b", 10),       // different addresses
		addrEvent("newer", 30617, "nostras", 300), // newer than local: kept
		addrEvent("tieHigh", 10002, "", 5),        // tie: lowest id wins
		addrEvent("tieA", 10002, "", 5),
	}
	got := map[string]bool{}
	for _, evt := range dropSupersededVersions(fetched, sent) {
		got[evt.ID] = true
	}
	want := []string{"note1", "p2", "badgeA", "badgeB", "newer", "tieA"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for _, id := range want {
		if !got[id] {
			t.Errorf("missing %s in %v", id, got)
		}
	}

	// Same version as the local one (already sent, same id) is dropped too.
	if out := dropSupersededVersions([]*nostr.Event{localRepo}, sent); len(out) != 0 {
		t.Errorf("same version as local passed through: %v", out)
	}
}
