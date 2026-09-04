package main

import (
	"encoding/json"
	"fmt"
	"net/mail"
	"os"
	"strings"
	"sync"
	"time"
)

// NOSTRAS Node waitlist signups — validating real demand for a self-
// hosted/managed relay+DVM product before building any actual tiering,
// licensing, or multi-tenant infra (see nostras-node-productization-
// strategy.md's own "cheapest possible validation" recommendation).
// Deliberately NOT a Nostr event: an email address is real personal
// data with no reason to ever be public, unlike everything else this
// relay persists as broadcastable protocol data. Same plain
// mutex-guarded JSON file shape as pushStore/vanishStore/analyticsStore
// — a small amount of data, no reason to add a real database for it.
type waitlistEntry struct {
	Email     string `json:"email"`
	Note      string `json:"note,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

// maxWaitlistNoteLen bounds the free-form "what would you use it for"
// field — a public, unauthenticated endpoint with an unbounded text
// field is a cheap abuse vector otherwise.
const maxWaitlistNoteLen = 1000

// maxWaitlistEmailLen bounds the email field too — found missing during
// a dashboard-hardening pass (2026-09-04): unlike note, nothing capped
// email's length at all, so a validly-RFC-822-shaped but absurdly long
// address (still possible within the outer request-body size limit) had
// no defense of its own beyond that outer cap. A real email address is
// never anywhere close to this long.
const maxWaitlistEmailLen = 254

type waitlistStore struct {
	mu      sync.RWMutex
	path    string
	entries []waitlistEntry
}

func newWaitlistStore(path string) (*waitlistStore, error) {
	s := &waitlistStore{path: path}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &s.entries); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *waitlistStore) saveLocked() error {
	raw, err := json.Marshal(s.entries)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, raw, 0600)
}

// add validates the email is at least well-formed (not that it's
// deliverable — this is a low-stakes marketing signup, not an account
// system) and dedupes by email so repeat submissions from the same
// visitor update their note rather than piling up duplicate rows.
func (s *waitlistStore) add(email, note string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if len(email) > maxWaitlistEmailLen {
		return fmt.Errorf("email address too long")
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return err
	}
	note = strings.TrimSpace(note)
	if len(note) > maxWaitlistNoteLen {
		note = note[:maxWaitlistNoteLen]
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for i, e := range s.entries {
		if e.Email == email {
			s.entries[i].Note = note
			s.entries[i].CreatedAt = time.Now().Unix()
			return s.saveLocked()
		}
	}
	s.entries = append(s.entries, waitlistEntry{Email: email, Note: note, CreatedAt: time.Now().Unix()})
	return s.saveLocked()
}

func (s *waitlistStore) snapshot() []waitlistEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]waitlistEntry, len(s.entries))
	copy(out, s.entries)
	return out
}
