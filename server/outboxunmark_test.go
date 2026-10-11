package main

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/nbd-wtf/go-nostr"
)

func TestOutboxUnmarkKeepsNostrasUsersPosts(t *testing.T) {
	ctx := context.Background()
	db := &badger.BadgerBackend{Path: t.TempDir()}
	if err := db.Init(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cache, err := newOutboxCacheStore(filepath.Join(t.TempDir(), "cache.json"))
	if err != nil {
		t.Fatal(err)
	}

	user, stranger := nostr.GeneratePrivateKey(), nostr.GeneratePrivateKey()
	mk := func(sk string, created int64, tags nostr.Tags) *nostr.Event {
		e := &nostr.Event{Kind: 1, CreatedAt: nostr.Timestamp(created), Tags: tags, Content: "x"}
		if err := e.Sign(sk); err != nil {
			t.Fatal(err)
		}
		if err := db.SaveEvent(ctx, e); err != nil {
			t.Fatal(err)
		}
		cache.track(e.ID, 1)
		return e
	}
	tagged := mk(user, nostrasLaunch+100, nostr.Tags{{"client", "Nostras"}})
	untaggedAfterLaunch := mk(user, nostrasLaunch+50, nil)
	userPreLaunch := mk(user, nostrasLaunch-50, nil)
	strangerPost := mk(stranger, nostrasLaunch+100, nil)

	users, unmarked := runOutboxUnmark(ctx, db, cache)
	if users != 1 || unmarked != 2 {
		t.Fatalf("users=%d unmarked=%d, want 1 and 2", users, unmarked)
	}
	for _, e := range []*nostr.Event{tagged, untaggedAfterLaunch} {
		if cache.isTracked(e.ID) {
			t.Errorf("NOSTRAS user's post %s still marked as cache", e.ID[:8])
		}
	}
	for _, e := range []*nostr.Event{userPreLaunch, strangerPost} {
		if !cache.isTracked(e.ID) {
			t.Errorf("post %s should stay marked as cache", e.ID[:8])
		}
	}
}
