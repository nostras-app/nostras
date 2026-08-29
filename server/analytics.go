package main

import (
	"context"
	"encoding/json"
	"net/netip"
	"os"
	"sync"
	"time"

	"github.com/fiatjaf/khatru"
	geoip2 "github.com/oschwald/geoip2-golang/v2"
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

// Country lookup used to be a live HTTPS call to ipapi.co's free tier per
// connection (cached for an hour to cut *repeat* lookups of the same IP).
// Confirmed live (2026-08-29) that this was never actually the fix it
// looked like: firing a handful of rapid lookups from this relay's own Fly
// egress IP against ipapi.co got real 429s within the first ~5 requests,
// and every subsequent request stayed 429'd — this relay's real connection
// volume (tens of thousands/day) blows through whatever ipapi.co's actual
// burst/quota limit is almost immediately, regardless of the cache, since
// the cache only ever helped with *repeat* IPs, never the dominant case of
// many distinct new ones. This directly explains the "unknown" bucket
// dominating every day's real data by one to two orders of magnitude,
// something earlier investigation flagged as a genuine, unresolved gap.
//
// Replaced with a local, offline MMDB (MaxMind DB format) country lookup —
// DB-IP's free "Lite" country database (CC BY 4.0, no signup/API key,
// updated monthly, schema-compatible with MaxMind's own GeoLite2-Country
// via the same `country.iso_code` field — see server/Dockerfile for where
// it's downloaded into the image). This eliminates the whole class of
// problem: no network call, no rate limit, no daily quota, sub-millisecond
// lookups regardless of connection volume — and, as a genuine side benefit
// consistent with this project's own "IP used only transiently, never
// stored" design intent, no third party ever sees a visitor's IP at all
// anymore, not even transiently.
type geoIPLookup struct {
	reader *geoip2.Reader
}

// openGeoIPLookup returns a nil-reader lookup (degrades every country to
// "unknown", not an error) if the database file isn't present — matters
// for local dev, which never bakes the Docker-image-only file in, and
// matches this codebase's standing "OFF (X not set/found)" degrade
// convention for every other optional feature.
func openGeoIPLookup(path string) (*geoIPLookup, error) {
	reader, err := geoip2.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &geoIPLookup{}, nil
		}
		return nil, err
	}
	return &geoIPLookup{reader: reader}, nil
}

func (g *geoIPLookup) country(ip string) string {
	if g.reader == nil || ip == "" {
		return ""
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ""
	}
	record, err := g.reader.Country(addr)
	if err != nil || record.Country.ISOCode == "" {
		return ""
	}
	return record.Country.ISOCode
}

// newAnalyticsConnectHook returns a khatru OnConnect hook. The lookup
// itself is now a fast local operation (no network round trip), but the
// store write still happens in a goroutine — same "never block the
// connection handshake" discipline as every other hot-path hook in this
// codebase, cheap insurance against ever reintroducing that class of
// problem even though this particular call is no longer the risk it once
// was.
func newAnalyticsConnectHook(store *analyticsStore, geoip *geoIPLookup) func(ctx context.Context) {
	return func(ctx context.Context) {
		ip := khatru.GetIP(ctx)
		go func() {
			store.record(geoip.country(ip))
		}()
	}
}
