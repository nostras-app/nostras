package main

import (
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/fiatjaf/khatru"
)

// Counts page views for the static public pages (landing, /why, /node),
// bucketed by page, day, and country — the same aggregate, no-PII shape
// already proven for relay-connection analytics (analytics.go), just with
// an extra "which page" dimension. The raw IP is used only transiently for
// the country lookup (geoLookupCountryCached, reused as-is) and is never
// stored.
type pageViewStore struct {
	mu     sync.Mutex
	path   string
	Total  int                                  `json:"total"`
	ByPage map[string]map[string]map[string]int `json:"by_page"` // page -> "2026-08-16" -> country -> count
}

func newPageViewStore(path string) (*pageViewStore, error) {
	s := &pageViewStore{path: path, ByPage: map[string]map[string]map[string]int{}}
	data, err := os.ReadFile(path)
	if err == nil {
		if uErr := json.Unmarshal(data, s); uErr != nil {
			return nil, uErr
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if s.ByPage == nil {
		s.ByPage = map[string]map[string]map[string]int{}
	}
	return s, nil
}

func (s *pageViewStore) record(page, country string) {
	if country == "" {
		country = "unknown"
	}
	day := time.Now().UTC().Format("2006-01-02")

	s.mu.Lock()
	defer s.mu.Unlock()
	s.Total++
	if s.ByPage[page] == nil {
		s.ByPage[page] = map[string]map[string]int{}
	}
	if s.ByPage[page][day] == nil {
		s.ByPage[page][day] = map[string]int{}
	}
	s.ByPage[page][day][country]++
	s.saveLocked()
}

// Caller must hold s.mu.
func (s *pageViewStore) saveLocked() {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(s.path, data, 0o600)
}

// Returns a plain-value copy safe to serialize without holding the lock —
// same reasoning as analyticsStore.snapshot().
func (s *pageViewStore) snapshot() pageViewStore {
	s.mu.Lock()
	defer s.mu.Unlock()
	byPage := make(map[string]map[string]map[string]int, len(s.ByPage))
	for page, byDay := range s.ByPage {
		d := make(map[string]map[string]int, len(byDay))
		for day, countries := range byDay {
			c := make(map[string]int, len(countries))
			for k, v := range countries {
				c[k] = v
			}
			d[day] = c
		}
		byPage[page] = d
	}
	return pageViewStore{Total: s.Total, ByPage: byPage}
}

// wrapPageView returns a middleware that records a page view (geo lookup +
// store write dispatched in a goroutine, same "never block the hot path"
// reasoning as newAnalyticsConnectHook — a page load must never wait on a
// third-party geo API) before serving the page itself.
func wrapPageView(store *pageViewStore, page string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := khatru.GetIPFromRequest(r)
		go func() {
			country := geoLookupCountryCached(ip)
			store.record(page, country)
		}()
		next(w, r)
	}
}
