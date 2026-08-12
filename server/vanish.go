package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

// NIP-62 "Request to Vanish" — a real, deliberately narrow persistent
// record of which pubkeys have asked this relay to erase their data,
// and up to what timestamp. Plain JSON file (mutex-guarded), matching
// this project's established pattern for small, non-Nostr-event
// operational state (see push.go's pushStore, analytics.go's
// analyticsStore) rather than a second database.
//
// This is what makes the NIP-62 requirement "MUST ensure the deleted
// events cannot be re-broadcasted into the relay" durable rather than a
// one-time sweep: relay.RejectEvent (see main.go) checks every future
// incoming event against this store. Deliberately scoped to "createdAt
// <= vanishedUntil", not a blanket ban on the pubkey forever — someone
// who vanished can still publish genuinely new events later if they
// choose to keep using the identity; this only blocks resurrecting
// exactly what they asked to be erased.
type vanishStore struct {
	mu   sync.RWMutex
	path string
	data map[string]int64 // pubkey -> vanished-until unix timestamp
}

func newVanishStore(path string) (*vanishStore, error) {
	s := &vanishStore{path: path, data: map[string]int64{}}
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

func (s *vanishStore) saveLocked() error {
	raw, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, raw, 0600)
}

// recordVanish extends (never shrinks) the vanished-until timestamp for
// a pubkey — a second, later vanish request from the same pubkey widens
// the blocked window rather than resetting it.
func (s *vanishStore) recordVanish(pubkey string, until int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.data[pubkey]; ok && existing >= until {
		return nil
	}
	s.data[pubkey] = until
	return s.saveLocked()
}

func (s *vanishStore) isBlocked(pubkey string, createdAt int64) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	until, ok := s.data[pubkey]
	return ok && createdAt <= until
}

// newVanishEventSavedHook returns an OnEventSaved hook that, when a
// stored event is a real NIP-62 vanish request (kind 62), triggers the
// actual erasure: every event this relay has stored from that pubkey up
// through the request's own timestamp, plus any NIP-59 gift wraps
// (kind 1059) #p-tagging that pubkey (their received DMs) in the same
// window — reusing relay.DeleteEvent's existing hook chain (db +
// searchIndex together, the same chain NIP-09 deletion already uses),
// so search-index purging isn't a separate thing to remember.
//
// Dispatched in a goroutine, not run inline: OnEventSaved runs
// synchronously on the hot path for every single event this relay
// stores — the same lock-contention lesson already learned once from
// the push-notification outage earlier in this project — and a vanish
// request can mean querying and deleting a real user's entire history,
// not fast. Queries go straight to db.QueryEvents (the badger backend
// directly), not through relay.QueryEvents's outbox-aggregation-aware
// wrapper — this only ever needs to know what's stored locally, fetching
// from other relays would be actively wrong here.
func newVanishEventSavedHook(relay *khatru.Relay, db *badger.BadgerBackend, store *vanishStore) func(ctx context.Context, evt *nostr.Event) {
	return func(_ context.Context, evt *nostr.Event) {
		if evt.Kind != 62 {
			return
		}
		pubkey := evt.PubKey
		until := evt.CreatedAt

		go func() {
			bg := context.Background()

			deleteMatching := func(filter nostr.Filter) {
				ch, err := db.QueryEvents(bg, filter)
				if err != nil {
					fmt.Println("vanish: query failed:", err)
					return
				}
				for target := range ch {
					for _, del := range relay.DeleteEvent {
						if err := del(bg, target); err != nil {
							fmt.Println("vanish: delete failed:", err)
						}
					}
				}
			}

			deleteMatching(nostr.Filter{Authors: []string{pubkey}, Until: &until})
			deleteMatching(nostr.Filter{Kinds: []int{1059}, Tags: nostr.TagMap{"p": []string{pubkey}}, Until: &until})

			if err := store.recordVanish(pubkey, int64(until)); err != nil {
				fmt.Println("vanish: could not record vanish:", err)
			}
		}()
	}
}

// newVanishRejectEventHook returns a RejectEvent hook that blocks any
// event falling within a pubkey's already-vanished window — see
// vanishStore's own comment for why this is scoped to
// createdAt <= vanishedUntil rather than a blanket ban.
func newVanishRejectEventHook(store *vanishStore) func(ctx context.Context, evt *nostr.Event) (bool, string) {
	return func(_ context.Context, evt *nostr.Event) (bool, string) {
		if store.isBlocked(evt.PubKey, int64(evt.CreatedAt)) {
			return true, "blocked: this pubkey requested erasure of events up to this point (NIP-62)"
		}
		return false, ""
	}
}
