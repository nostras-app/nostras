package main

import (
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"
)

// Counts real NOSTRAS client loads, day-bucketed only — the intentionally
// simpler sibling of analyticsStore/pageViewStore. Built 2026-09-06,
// directly prompted by a real operator question: the dashboard's raw
// connection count mixes in every other Nostr client, every relay doing
// NIP-65 outbox lookups against this one, and relay-monitoring/crawler
// traffic (this relay is publicly listed on nostr.watch and self-
// advertises via NIP-66) — none of that is "how many real NOSTRAS
// clients are out there," which was the actual question.
//
// Deliberately carries NO per-client identifier of any kind, not even a
// discarded one — see client/src/lib/clientHeartbeat.ts's own comment for
// why a client-generated-but-unused random value would add no real
// privacy protection over sending nothing at all. The safety property
// here lives entirely on this side: nothing sent to this endpoint is
// stored, correlated, or even read beyond "a request arrived" — the
// handler doesn't parse a body, doesn't look at headers beyond what
// net/http already needs, and the store below has no field capable of
// holding a per-caller value even if one were sent. This is a plain
// day-bucketed counter, not a session or device tracker: querying it
// twice in the same second from the same browser counts as two, and
// nothing here can tell that apart from two different browsers, on
// purpose. See the real assessed GDPR reasoning in
// nostr-client-node-strategy.md's own dated entry for why that
// non-recognition is what actually keeps this outside "tracking," not
// merely the absence of a name.
//
// Honest limitation, same category as this project's other soft metrics
// ("seen on N relays," follower counts, etc.): nothing here verifies a
// request genuinely came from the real client vs. a script hitting this
// URL directly — the count can be inflated by anyone who finds it. Low
// stakes (an internal operator signal, not billing or security-critical),
// disclosed rather than solved.
type heartbeatStore struct {
	mu    sync.Mutex
	path  string
	Total int            `json:"total"`
	ByDay map[string]int `json:"by_day"`
}

func newHeartbeatStore(path string) (*heartbeatStore, error) {
	s := &heartbeatStore{path: path, ByDay: map[string]int{}}
	data, err := os.ReadFile(path)
	if err == nil {
		if uErr := json.Unmarshal(data, s); uErr != nil {
			return nil, uErr
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if s.ByDay == nil {
		s.ByDay = map[string]int{}
	}
	return s, nil
}

func (s *heartbeatStore) record() {
	day := time.Now().UTC().Format("2006-01-02")

	s.mu.Lock()
	defer s.mu.Unlock()
	s.Total++
	s.ByDay[day]++
	s.saveLocked()
}

// Caller must hold s.mu.
func (s *heartbeatStore) saveLocked() {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(s.path, data, 0o600)
}

// Returns a plain-value copy safe to serialize without holding the lock —
// same reasoning as analyticsStore.snapshot()/pageViewStore.snapshot().
func (s *heartbeatStore) snapshot() heartbeatStore {
	s.mu.Lock()
	defer s.mu.Unlock()
	byDay := make(map[string]int, len(s.ByDay))
	for k, v := range s.ByDay {
		byDay[k] = v
	}
	return heartbeatStore{Total: s.Total, ByDay: byDay}
}

// handleClientHeartbeat is deliberately unauthenticated (like /node's
// waitlist endpoint) — a real NOSTRAS client should be able to call this
// the instant it loads, before any signer/identity is resolved. The
// record happens in a goroutine, same "never block the caller" reasoning
// as newAnalyticsConnectHook/wrapPageView, and the response is
// unconditional 204 regardless of outcome — this is fire-and-forget by
// design, not something the client should ever retry or check.
func handleClientHeartbeat(store *heartbeatStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		go store.record()
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleDashboardHeartbeat mirrors handleDashboardPageViews exactly —
// operator-only, same reasoning: an internal usage signal, not something
// to present as a public vanity metric the way /stats does for raw
// connection counts.
func handleDashboardHeartbeat(store *heartbeatStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(store.snapshot())
	}
}
