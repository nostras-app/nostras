package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/nbd-wtf/go-nostr"
)

// Storage diagnostic: walks the whole badger store once, in the
// background, and reports what's actually in it by kind, by source
// (outbox-cached vs. stored directly on this relay), by age and by
// author. Built after the third disk-full outage (PQ-093): from outside
// the relay, whole-store COUNTs and kind-less time-window REQs both time
// out in production, so there was no way to tell what the 5GB event store
// is made of. Operator-only (dashboard password), on-demand, one scan at
// a time, results kept in memory only.

type storageBucket struct {
	Count       int   `json:"count"`
	Bytes       int64 `json:"bytes"`
	OutboxCount int   `json:"outboxCount"`
	OutboxBytes int64 `json:"outboxBytes"`
}

func (b *storageBucket) add(size int, outbox bool) {
	b.Count++
	b.Bytes += int64(size)
	if outbox {
		b.OutboxCount++
		b.OutboxBytes += int64(size)
	}
}

type storageKindRow struct {
	Kind int `json:"kind"`
	storageBucket
}

type storageAuthorRow struct {
	Pubkey string `json:"pubkey"`
	Count  int    `json:"count"`
	Bytes  int64  `json:"bytes"`
	// Kinds this author's direct events mostly are, largest first (top 3).
	TopKinds []int `json:"topKinds"`
}

type storageScanResult struct {
	Running    bool   `json:"running"`
	StartedAt  int64  `json:"startedAt,omitempty"`
	FinishedAt int64  `json:"finishedAt,omitempty"`
	Error      string `json:"error,omitempty"`

	Total storageBucket `json:"total"`
	// Age by the event's own created_at, not by when it was stored.
	Age map[string]storageBucket `json:"age"`
	// Largest kinds by bytes (top 40).
	Kinds []storageKindRow `json:"kinds"`
	// Largest direct (non-outbox) authors by bytes (top 25): who is
	// publishing to this relay itself.
	TopDirectAuthors      []storageAuthorRow `json:"topDirectAuthors"`
	DistinctDirectAuthors int                `json:"distinctDirectAuthors"`
	DistinctOutboxAuthors int                `json:"distinctOutboxAuthors"`
}

type storageScanner struct {
	db          *badger.BadgerBackend
	outboxCache *outboxCacheStore

	mu     sync.Mutex
	result storageScanResult
}

func newStorageScanner(db *badger.BadgerBackend, outboxCache *outboxCacheStore) *storageScanner {
	return &storageScanner{db: db, outboxCache: outboxCache}
}

func (s *storageScanner) snapshot() storageScanResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.result
}

func (s *storageScanner) start() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.result.Running {
		return false
	}
	s.result = storageScanResult{Running: true, StartedAt: time.Now().Unix()}
	go s.run()
	return true
}

type authorAgg struct {
	count int
	bytes int64
	kinds map[int]int64
}

func ageBucket(createdAt, now int64) string {
	switch d := now - createdAt; {
	case d < 86400:
		return "under1d"
	case d < 7*86400:
		return "1to7d"
	case d < 30*86400:
		return "7to30d"
	case d < 365*86400:
		return "30dto1y"
	default:
		return "over1y"
	}
}

// storageScanProgressEvery controls how often partial totals are
// published to snapshot() and how often the scan sleeps, so it never
// monopolizes badger while live traffic is being served.
const storageScanProgressEvery = 5000

func (s *storageScanner) run() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()

	now := time.Now().Unix()
	var total storageBucket
	age := map[string]storageBucket{}
	kinds := map[int]*storageBucket{}
	direct := map[string]*authorAgg{}
	outboxAuthors := map[string]bool{}
	seen := 0

	err := s.db.ScanRawEvents(ctx, storageScanProgressEvery, func(evt *nostr.Event, size int) bool {
		outbox := s.outboxCache != nil && s.outboxCache.isTracked(evt.ID)
		total.add(size, outbox)
		a := age[ageBucket(int64(evt.CreatedAt), now)]
		a.add(size, outbox)
		age[ageBucket(int64(evt.CreatedAt), now)] = a
		k := kinds[evt.Kind]
		if k == nil {
			k = &storageBucket{}
			kinds[evt.Kind] = k
		}
		k.add(size, outbox)

		if outbox {
			outboxAuthors[evt.PubKey] = true
		} else {
			d := direct[evt.PubKey]
			if d == nil {
				d = &authorAgg{kinds: map[int]int64{}}
				direct[evt.PubKey] = d
			}
			d.count++
			d.bytes += int64(size)
			d.kinds[evt.Kind] += int64(size)
		}

		seen++
		if seen%storageScanProgressEvery == 0 {
			s.mu.Lock()
			s.result.Total = total
			s.mu.Unlock()
			time.Sleep(20 * time.Millisecond)
		}
		return true
	})

	kindRows := make([]storageKindRow, 0, len(kinds))
	for kind, b := range kinds {
		kindRows = append(kindRows, storageKindRow{Kind: kind, storageBucket: *b})
	}
	sort.Slice(kindRows, func(i, j int) bool { return kindRows[i].Bytes > kindRows[j].Bytes })
	if len(kindRows) > 40 {
		kindRows = kindRows[:40]
	}

	authorRows := make([]storageAuthorRow, 0, len(direct))
	for pk, d := range direct {
		authorRows = append(authorRows, storageAuthorRow{Pubkey: pk, Count: d.count, Bytes: d.bytes, TopKinds: topKinds(d.kinds, 3)})
	}
	sort.Slice(authorRows, func(i, j int) bool { return authorRows[i].Bytes > authorRows[j].Bytes })
	if len(authorRows) > 25 {
		authorRows = authorRows[:25]
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.result.Running = false
	s.result.FinishedAt = time.Now().Unix()
	s.result.Total = total
	s.result.Age = age
	s.result.Kinds = kindRows
	s.result.TopDirectAuthors = authorRows
	s.result.DistinctDirectAuthors = len(direct)
	s.result.DistinctOutboxAuthors = len(outboxAuthors)
	if err != nil {
		s.result.Error = err.Error()
	}
	fmt.Printf("storage scan: done, %d events, %d bytes (%d outbox-cached)\n", total.Count, total.Bytes, total.OutboxCount)
}

func topKinds(m map[int]int64, n int) []int {
	ks := make([]int, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Slice(ks, func(i, j int) bool { return m[ks[i]] > m[ks[j]] })
	if len(ks) > n {
		ks = ks[:n]
	}
	return ks
}

func handleStorageScanStart(s *storageScanner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.start() {
			http.Error(w, "a storage scan is already running", http.StatusConflict)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}
}

func handleStorageScanStatus(s *storageScanner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s.snapshot())
	}
}
