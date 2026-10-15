package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

// Nymchat sync slots (2026-10-04, PQ-093 follow-up). Nymchat.app stores
// its app state on relays as NIP-59 gift wraps (kind:1059) tagged
// ["k","nym-sync"] plus a ["d", slot] tag, rewriting each slot on every
// sync. Kind 1059 is a regular event, so nothing is ever replaced: a
// storage scan found 3.34GB of gift wraps (73% of the store), about 90%
// of it nym-sync copies averaging ~22KB, and a sample showed the same
// (recipient, d) slot stored up to 14 times in a month.
//
// Per the owner's decision, each slot keeps only its newest
// nymSyncKeepPerSlot copies. Three rather than one because NIP-59 lets
// gift-wrap timestamps be randomized up to two days into the past, so
// "newest by created_at" isn't strictly the latest write. Only events
// with kind 1059, ["k","nym-sync"], exactly one p tag and exactly one d
// tag are slots; ordinary DM gift wraps (no d tag) are never touched.

const nymSyncKeepPerSlot = 3

type nymSyncSlot struct{ recipient, d string }

// nymSyncSlotOf returns the slot an event belongs to, or false if it
// isn't a nym-sync gift wrap.
func nymSyncSlotOf(evt *nostr.Event) (nymSyncSlot, bool) {
	if evt.Kind != 1059 {
		return nymSyncSlot{}, false
	}
	var ps, ds []string
	isSync := false
	for _, t := range evt.Tags {
		if len(t) < 2 {
			continue
		}
		switch t[0] {
		case "p":
			ps = append(ps, t[1])
		case "d":
			ds = append(ds, t[1])
		case "k":
			if t[1] == "nym-sync" {
				isSync = true
			}
		}
	}
	if !isSync || len(ps) != 1 || len(ds) != 1 || ps[0] == "" || ds[0] == "" {
		return nymSyncSlot{}, false
	}
	return nymSyncSlot{recipient: ps[0], d: ds[0]}, true
}

// slotCopy is one stored copy of a slot, enough to rank it.
type slotCopy struct {
	id        string
	createdAt nostr.Timestamp
}

// copiesToDrop ranks copies newest-first (ties broken by id, so the
// result is deterministic) and returns the ids beyond the newest keep.
func copiesToDrop(copies []slotCopy, keep int) []string {
	if len(copies) <= keep {
		return nil
	}
	sort.Slice(copies, func(i, j int) bool {
		if copies[i].createdAt != copies[j].createdAt {
			return copies[i].createdAt > copies[j].createdAt
		}
		return copies[i].id > copies[j].id
	})
	drop := make([]string, 0, len(copies)-keep)
	for _, c := range copies[keep:] {
		drop = append(drop, c.id)
	}
	return drop
}

// deleteByIDs deletes events by id through the relay's normal delete
// chain (badger + search index), in batches, paced.
func deleteByIDs(ctx context.Context, db *badger.BadgerBackend, deleters []func(context.Context, *nostr.Event) error, ids []string) int {
	deleted := 0
	for i := 0; i < len(ids); i += 200 {
		end := min(i+200, len(ids))
		ch, err := db.QueryEvents(ctx, nostr.Filter{IDs: ids[i:end]})
		if err != nil {
			continue
		}
		for evt := range ch {
			for _, del := range deleters {
				del(ctx, evt)
			}
			deleted++
		}
		time.Sleep(20 * time.Millisecond)
	}
	return deleted
}

// pruneSlot trims one slot to its newest copies.
func pruneSlot(ctx context.Context, db *badger.BadgerBackend, deleters []func(context.Context, *nostr.Event) error, slot nymSyncSlot) int {
	ch, err := db.QueryEvents(ctx, nostr.Filter{
		Kinds: []int{1059},
		Tags:  nostr.TagMap{"p": []string{slot.recipient}, "d": []string{slot.d}},
		Limit: maxFilterLimit,
	})
	if err != nil {
		return 0
	}
	var copies []slotCopy
	for evt := range ch {
		// Re-check the full slot shape: the tag query matches p and d but
		// not k, and an ordinary wrap must never be counted.
		if s, ok := nymSyncSlotOf(evt); ok && s == slot {
			copies = append(copies, slotCopy{evt.ID, evt.CreatedAt})
		}
	}
	return deleteByIDs(ctx, db, deleters, copiesToDrop(copies, nymSyncKeepPerSlot))
}

// nymSyncPruner trims slots in the background as new copies arrive. The
// StoreEvent hook only enqueues; a single worker does the queries and
// deletes, so the save path never waits on them. If the queue is full
// the slot is skipped this time; its next write enqueues it again.
type nymSyncPruner struct {
	db       *badger.BadgerBackend
	deleters func() []func(context.Context, *nostr.Event) error
	queue    chan nymSyncSlot
}

func newNymSyncPruner(db *badger.BadgerBackend, relay *khatru.Relay) *nymSyncPruner {
	p := &nymSyncPruner{
		db:       db,
		deleters: func() []func(context.Context, *nostr.Event) error { return relay.DeleteEvent },
		queue:    make(chan nymSyncSlot, 1000),
	}
	go func() {
		for slot := range p.queue {
			pruneSlot(context.Background(), p.db, p.deleters(), slot)
		}
	}()
	return p
}

func (p *nymSyncPruner) storeHook(_ context.Context, evt *nostr.Event) error {
	if slot, ok := nymSyncSlotOf(evt); ok {
		select {
		case p.queue <- slot:
		default:
		}
	}
	return nil
}

// startNymSyncBackfill trims every existing slot once, in the background.
// It collects only (slot, id, created_at) while walking the store, then
// deletes the extras by id. A marker file records completion; an
// interrupted run runs again on the next boot.
func startNymSyncBackfill(db *badger.BadgerBackend, relay *khatru.Relay, dataDir string) {
	marker := filepath.Join(dataDir, "nym-sync-prune.done")
	if _, err := os.Stat(marker); err == nil {
		return
	}
	go func() {
		time.Sleep(3 * time.Minute) // after the boot-time work settles
		start := time.Now()
		slots, deleted := runNymSyncBackfill(context.Background(), db, relay.DeleteEvent)
		if err := os.WriteFile(marker, []byte(time.Now().UTC().Format(time.RFC3339)+"\n"), 0600); err != nil {
			fmt.Println("nym-sync prune: could not write marker:", err)
		}
		fmt.Printf("nym-sync prune: %d slots, deleted %d older copies in %s\n",
			slots, deleted, time.Since(start).Round(time.Second))
	}()
}

func runNymSyncBackfill(ctx context.Context, db *badger.BadgerBackend, deleters []func(context.Context, *nostr.Event) error) (slots, deleted int) {
	bySlot := map[nymSyncSlot][]slotCopy{}
	scanned := 0
	db.ScanRawEvents(ctx, 5000, func(evt *nostr.Event, _ int) bool {
		scanned++
		if slot, ok := nymSyncSlotOf(evt); ok {
			bySlot[slot] = append(bySlot[slot], slotCopy{evt.ID, evt.CreatedAt})
		}
		if scanned%5000 == 0 {
			time.Sleep(20 * time.Millisecond)
		}
		return true
	})
	var drop []string
	for _, copies := range bySlot {
		drop = append(drop, copiesToDrop(copies, nymSyncKeepPerSlot)...)
	}
	return len(bySlot), deleteByIDs(ctx, db, deleters, drop)
}

// One-time purge (2026-10-15, owner decision). Since 27d8dbc the relay
// refuses new nym-sync wraps (storagepolicy.go), so the trimmed copies the
// backfill above kept are just leftover data. This deletes every stored
// event isNymSyncWrap matches, the same match the refusal uses. Ordinary
// DM gift wraps have no k=nym-sync tag and are never touched. A marker
// file records completion; an interrupted run runs again on next boot.
func startNymSyncPurge(db *badger.BadgerBackend, relay *khatru.Relay, dataDir string) {
	marker := filepath.Join(dataDir, "nym-sync-purge.done")
	if _, err := os.Stat(marker); err == nil {
		return
	}
	go func() {
		time.Sleep(3 * time.Minute)
		start := time.Now()
		deleted := runNymSyncPurge(context.Background(), db, relay.DeleteEvent)
		if err := os.WriteFile(marker, []byte(time.Now().UTC().Format(time.RFC3339)+"\n"), 0600); err != nil {
			fmt.Println("nym-sync purge: could not write marker:", err)
		}
		fmt.Printf("nym-sync purge: deleted %d stored nym-sync wraps in %s\n",
			deleted, time.Since(start).Round(time.Second))
	}()
}

func runNymSyncPurge(ctx context.Context, db *badger.BadgerBackend, deleters []func(context.Context, *nostr.Event) error) int {
	var ids []string
	scanned := 0
	db.ScanRawEvents(ctx, 5000, func(evt *nostr.Event, _ int) bool {
		scanned++
		if isNymSyncWrap(evt) {
			ids = append(ids, evt.ID)
		}
		if scanned%5000 == 0 {
			time.Sleep(20 * time.Millisecond)
		}
		return true
	})
	return deleteByIDs(ctx, db, deleters, ids)
}
