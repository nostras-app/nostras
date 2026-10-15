package main

import (
	"context"
	"testing"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/nbd-wtf/go-nostr"
)

func nymTestDB(t *testing.T) *badger.BadgerBackend {
	db := &badger.BadgerBackend{Path: t.TempDir(), MaxLimit: maxFilterLimit}
	if err := db.Init(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	return db
}

// wrap stores a gift wrap signed by a fresh key, like real NIP-59 wraps.
func wrap(t *testing.T, db *badger.BadgerBackend, ts int64, tags nostr.Tags) nostr.Event {
	e := nostr.Event{Kind: 1059, Content: "ciphertext", CreatedAt: nostr.Timestamp(ts), Tags: tags}
	e.Sign(nostr.GeneratePrivateKey())
	if err := db.SaveEvent(context.Background(), &e); err != nil {
		t.Fatal(err)
	}
	return e
}

func stillStored(t *testing.T, db *badger.BadgerBackend, ids ...string) map[string]bool {
	ch, _ := db.QueryEvents(context.Background(), nostr.Filter{IDs: ids})
	got := map[string]bool{}
	for e := range ch {
		got[e.ID] = true
	}
	return got
}

func syncTags(p, d string) nostr.Tags {
	return nostr.Tags{{"p", p}, {"d", d}, {"k", "nym-sync"}}
}

var deleteOnly = func(db *badger.BadgerBackend) []func(context.Context, *nostr.Event) error {
	return []func(context.Context, *nostr.Event) error{db.DeleteEvent}
}

func TestNymSyncSlotOf(t *testing.T) {
	p, d := "aa", "bb"
	cases := []struct {
		name string
		evt  nostr.Event
		ok   bool
	}{
		{"sync wrap", nostr.Event{Kind: 1059, Tags: syncTags(p, d)}, true},
		{"plain DM wrap", nostr.Event{Kind: 1059, Tags: nostr.Tags{{"p", p}}}, false},
		{"other k", nostr.Event{Kind: 1059, Tags: nostr.Tags{{"p", p}, {"d", d}, {"k", "other"}}}, false},
		{"two p", nostr.Event{Kind: 1059, Tags: append(syncTags(p, d), nostr.Tag{"p", "cc"})}, false},
		{"two d", nostr.Event{Kind: 1059, Tags: append(syncTags(p, d), nostr.Tag{"d", "dd"})}, false},
		{"wrong kind", nostr.Event{Kind: 30078, Tags: syncTags(p, d)}, false},
	}
	for _, c := range cases {
		if _, ok := nymSyncSlotOf(&c.evt); ok != c.ok {
			t.Errorf("%s: got %v, want %v", c.name, ok, c.ok)
		}
	}
}

// Live path: a slot with 6 copies keeps its newest 3. A different slot,
// a different recipient with the same d, a plain DM to the same recipient
// and a non-sync wrap with the same p+d are all left alone.
func TestPruneSlot(t *testing.T) {
	db := nymTestDB(t)
	p, other := "1111111111111111111111111111111111111111111111111111111111111111",
		"2222222222222222222222222222222222222222222222222222222222222222"
	d := "3333333333333333333333333333333333333333333333333333333333333333"
	var copies []nostr.Event
	for i := int64(0); i < 6; i++ {
		copies = append(copies, wrap(t, db, 1790000000+i*100, syncTags(p, d)))
	}
	otherSlot := wrap(t, db, 1790000000, syncTags(p, "4444444444444444444444444444444444444444444444444444444444444444"))
	otherRecipient := wrap(t, db, 1790000000, syncTags(other, d))
	plainDM := wrap(t, db, 1789999000, nostr.Tags{{"p", p}})
	lookalike := wrap(t, db, 1789999000, nostr.Tags{{"p", p}, {"d", d}, {"k", "not-sync"}})

	n := pruneSlot(context.Background(), db, deleteOnly(db), nymSyncSlot{p, d})
	if n != 3 {
		t.Fatalf("deleted %d, want 3", n)
	}
	ids := []string{otherSlot.ID, otherRecipient.ID, plainDM.ID, lookalike.ID}
	for _, c := range copies {
		ids = append(ids, c.ID)
	}
	got := stillStored(t, db, ids...)
	for i, c := range copies {
		want := i >= 3 // the 3 newest (highest created_at) survive
		if got[c.ID] != want {
			t.Errorf("copy %d stored=%v, want %v", i, got[c.ID], want)
		}
	}
	for name, e := range map[string]nostr.Event{"other slot": otherSlot, "other recipient": otherRecipient, "plain DM": plainDM, "look-alike": lookalike} {
		if !got[e.ID] {
			t.Errorf("%s was deleted", name)
		}
	}
}

// Backlog path: same rules across many slots at once.
func TestNymSyncBackfill(t *testing.T) {
	db := nymTestDB(t)
	p := "5555555555555555555555555555555555555555555555555555555555555555"
	slotA := "6666666666666666666666666666666666666666666666666666666666666666"
	slotB := "7777777777777777777777777777777777777777777777777777777777777777"
	for i := int64(0); i < 10; i++ {
		wrap(t, db, 1790000000+i, syncTags(p, slotA))
	}
	for i := int64(0); i < 2; i++ {
		wrap(t, db, 1790000000+i, syncTags(p, slotB))
	}
	plain := wrap(t, db, 1790000000, nostr.Tags{{"p", p}})

	slots, deleted := runNymSyncBackfill(context.Background(), db, deleteOnly(db))
	if slots != 2 || deleted != 7 {
		t.Fatalf("slots=%d deleted=%d, want 2 and 7", slots, deleted)
	}
	count := func(d string) int {
		ch, _ := db.QueryEvents(context.Background(), nostr.Filter{Kinds: []int{1059}, Tags: nostr.TagMap{"d": []string{d}}, Limit: 100})
		n := 0
		for range ch {
			n++
		}
		return n
	}
	if a, b := count(slotA), count(slotB); a != 3 || b != 2 {
		t.Errorf("slot A=%d (want 3), slot B=%d (want 2)", a, b)
	}
	if !stillStored(t, db, plain.ID)[plain.ID] {
		t.Error("plain DM deleted")
	}
}

// The store hook only enqueues; the worker trims the slot.
func TestNymSyncStoreHook(t *testing.T) {
	db := nymTestDB(t)
	p := "8888888888888888888888888888888888888888888888888888888888888888"
	d := "9999999999999999999999999999999999999999999999999999999999999999"
	pr := &nymSyncPruner{db: db, deleters: func() []func(context.Context, *nostr.Event) error { return deleteOnly(db) }, queue: make(chan nymSyncSlot, 10)}
	var last nostr.Event
	for i := int64(0); i < 5; i++ {
		last = wrap(t, db, 1790000000+i, syncTags(p, d))
	}
	plain := nostr.Event{Kind: 1059, Tags: nostr.Tags{{"p", p}}}
	pr.storeHook(context.Background(), &plain)
	pr.storeHook(context.Background(), &last)
	if len(pr.queue) != 1 {
		t.Fatalf("queued %d slots, want 1 (plain DM must not be queued)", len(pr.queue))
	}
	slot := <-pr.queue
	if n := pruneSlot(context.Background(), db, pr.deleters(), slot); n != 2 {
		t.Errorf("worker deleted %d, want 2", n)
	}
}

// Purge: every nym-sync wrap goes, ordinary DM wraps and other kinds stay.
func TestNymSyncPurge(t *testing.T) {
	db := nymTestDB(t)
	p := "8888888888888888888888888888888888888888888888888888888888888888"
	slot := "9999999999999999999999999999999999999999999999999999999999999999"
	var syncIDs []string
	for i := int64(0); i < 4; i++ {
		syncIDs = append(syncIDs, wrap(t, db, 1790000000+i, syncTags(p, slot)).ID)
	}
	plain := wrap(t, db, 1790000000, nostr.Tags{{"p", p}})

	if deleted := runNymSyncPurge(context.Background(), db, deleteOnly(db)); deleted != 4 {
		t.Fatalf("deleted=%d, want 4", deleted)
	}
	got := stillStored(t, db, append(syncIDs, plain.ID)...)
	for _, id := range syncIDs {
		if got[id] {
			t.Errorf("nym-sync wrap %s still stored", id[:8])
		}
	}
	if !got[plain.ID] {
		t.Error("plain DM wrap deleted")
	}
}
