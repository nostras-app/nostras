package main

import (
	"encoding/json"
	"os"
	"sync"
)

// Web Push subscriptions, keyed by pubkey. Deliberately NOT stored as Nostr
// events: a subscription's endpoint/keys are real device-identifying data
// that must stay private to this server, never broadcast to relays (unlike
// everything else this app persists, which is meant to be public Nostr
// data). A plain JSON file (mutex-guarded, matching the project's general
// preference for the simplest thing that works over adding a new DB
// dependency for a small amount of data) rather than a second badger
// instance.
type pushSubscription struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

type pushStore struct {
	mu   sync.RWMutex
	path string
	data map[string][]pushSubscription // pubkey -> subscriptions (multiple devices)
}

func newPushStore(path string) (*pushStore, error) {
	s := &pushStore{path: path, data: map[string][]pushSubscription{}}
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

func (s *pushStore) saveLocked() error {
	raw, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, raw, 0600)
}

// add is idempotent by endpoint — re-registering the same device (e.g. the
// browser refreshing its push subscription) replaces rather than duplicates.
func (s *pushStore) add(pubkey string, sub pushSubscription) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing := s.data[pubkey]
	next := make([]pushSubscription, 0, len(existing)+1)
	for _, e := range existing {
		if e.Endpoint != sub.Endpoint {
			next = append(next, e)
		}
	}
	s.data[pubkey] = append(next, sub)
	return s.saveLocked()
}

func (s *pushStore) remove(pubkey, endpoint string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing := s.data[pubkey]
	next := make([]pushSubscription, 0, len(existing))
	for _, e := range existing {
		if e.Endpoint != endpoint {
			next = append(next, e)
		}
	}
	if len(next) == 0 {
		delete(s.data, pubkey)
	} else {
		s.data[pubkey] = next
	}
	return s.saveLocked()
}

// removeEndpoint drops a subscription by endpoint alone, regardless of which
// pubkey it's filed under — used when a push service reports the endpoint
// is permanently gone (410 Gone), since at that point which pubkey it was
// registered to no longer matters.
func (s *pushStore) removeEndpoint(endpoint string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for pubkey, subs := range s.data {
		next := make([]pushSubscription, 0, len(subs))
		for _, e := range subs {
			if e.Endpoint == endpoint {
				changed = true
				continue
			}
			next = append(next, e)
		}
		if len(next) == 0 {
			delete(s.data, pubkey)
		} else {
			s.data[pubkey] = next
		}
	}
	if changed {
		s.saveLocked()
	}
}

func (s *pushStore) subscriptionsFor(pubkey string) []pushSubscription {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]pushSubscription, len(s.data[pubkey]))
	copy(out, s.data[pubkey])
	return out
}
