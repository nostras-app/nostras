package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/fiatjaf/khatru"
)

// Counts unique relay WebSocket connections, bucketed by day and by country
// — a rough proxy for "how many instances of NOSTRAS are running, and from
// where" for marketing purposes, not exact unique-visitor analytics. The
// raw IP address is used only transiently, for the country lookup below,
// and is never stored — only the resulting two-letter country code.
type analyticsStore struct {
	mu    sync.Mutex
	path  string
	Total int                       `json:"total"`
	ByDay map[string]map[string]int `json:"by_day"` // "2026-08-05" -> country code -> count
}

func newAnalyticsStore(path string) (*analyticsStore, error) {
	s := &analyticsStore{path: path, ByDay: map[string]map[string]int{}}
	data, err := os.ReadFile(path)
	if err == nil {
		if uErr := json.Unmarshal(data, s); uErr != nil {
			return nil, uErr
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if s.ByDay == nil {
		s.ByDay = map[string]map[string]int{}
	}
	return s, nil
}

func (s *analyticsStore) record(country string) {
	if country == "" {
		country = "unknown"
	}
	day := time.Now().UTC().Format("2006-01-02")

	s.mu.Lock()
	defer s.mu.Unlock()
	s.Total++
	if s.ByDay[day] == nil {
		s.ByDay[day] = map[string]int{}
	}
	s.ByDay[day][country]++
	s.saveLocked()
}

// Caller must hold s.mu.
func (s *analyticsStore) saveLocked() {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(s.path, data, 0o600)
}

// Returns a plain-value copy safe to serialize without holding the lock.
func (s *analyticsStore) snapshot() analyticsStore {
	s.mu.Lock()
	defer s.mu.Unlock()
	byDay := make(map[string]map[string]int, len(s.ByDay))
	for day, countries := range s.ByDay {
		c := make(map[string]int, len(countries))
		for k, v := range countries {
			c[k] = v
		}
		byDay[day] = c
	}
	return analyticsStore{Total: s.Total, ByDay: byDay}
}

// Free, no-API-key country lookup — returns "" on any failure (rate limit,
// timeout, malformed response), which record() buckets as "unknown" rather
// than blocking or erroring. The IP is sent to this third party for the
// lookup itself (unavoidable — that's how IP geolocation works) but is
// never written to disk or logged by this relay.
func geoLookupCountry(ip string) string {
	if ip == "" {
		return ""
	}
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("https://ipapi.co/" + ip + "/country/")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16))
	if err != nil {
		return ""
	}
	code := strings.ToUpper(strings.TrimSpace(string(body)))
	if len(code) != 2 {
		return ""
	}
	return code
}

// newAnalyticsConnectHook returns a khatru OnConnect hook. Dispatches the
// geo lookup and the store write in a goroutine so a slow/unreachable geo
// API never adds latency to the connection handshake itself — the same
// "never block the hot path" lesson learned the hard way from the push
// notification lock-contention incident (see CLAUDE.md).
func newAnalyticsConnectHook(store *analyticsStore) func(ctx context.Context) {
	return func(ctx context.Context) {
		ip := khatru.GetIP(ctx)
		go func() {
			country := geoLookupCountry(ip)
			store.record(country)
		}()
	}
}
