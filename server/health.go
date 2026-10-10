package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

// Lock-free (sync/atomic only, no mutex) — OnConnect/OnDisconnect run per
// connection and OnEventSaved runs in the same hot path as every event
// this relay stores, so these hooks must stay trivially cheap. This is
// the same lesson the push-notification lock-contention outage taught the
// hard way (see CLAUDE.md) — applied proactively here instead. The
// disconnectSeen map (below) is the one exception, guarded by a plain
// mutex — connection open/close happens at connection-churn frequency,
// not event frequency, so it doesn't carry the same hot-path risk.
var (
	processStartedAt = time.Now()
	liveConnections  int64
	dvmEventTotal    int64
	lastDvmEventAt   int64 // unix seconds; 0 = never observed since boot
)

// Real production incident (2026-08-07): this relay is publicly discoverable
// (real domain, NIP-11, linked from the landing page and docs org), and
// live connection count climbed to 305+ within under an hour of a fresh
// boot with no code-level leak found — khatru's own ping/pong keepalive
// (30s period, 60s pong wait, confirmed correctly configured) was reaping
// genuinely-dead connections as expected, so this reads as real connection
// volume (likely including the broader Nostr ecosystem's relay-monitoring/
// crawler bots, which commonly hold long-lived connections open to any
// publicly known relay) outgrowing this machine's 512MB budget, not a bug.
// MemAvailable dropped from ~327MB (fresh boot, 0 connections) to ~24MB
// (305 connections) before a manual restart relieved it — roughly 1MB/
// connection, consistent with WS buffers + goroutine stacks + khatru/NDK
// overhead. Capped well below the observed failure point, same
// bound-it-and-degrade-gracefully approach as authorFetchSem/broadcastSem
// elsewhere in this codebase: past this many concurrent connections, new
// ones are refused with a clean 429 (via khatru's RejectConnection hook,
// which runs before the WebSocket upgrade) rather than accepted and left
// to starve the machine an existing client's publish/query depends on.
//
// Raised 200 -> 1000 on 2026-09-01: `web` is now a 4GB machine (up from
// the 512MB this cap was originally sized against), and real production
// traffic had already grown past the old cap — a live health check found
// ~333 real connections in the table, well over 200, causing genuine
// publish failures/502s until a restart cleared it. At the same
// ~1MB/connection rate, 1000 connections is ~1GB, leaving several GB of
// real headroom on this machine for badger/bluge/the Go runtime (whose
// own tuned worst-case footprint is ~110-150MB, see the badger
// BadgerOptionsModifier comment in main.go) — a deliberately moderate
// jump (5x, ~3x above the observed real peak) rather than removing the
// cap outright, consistent with this project's own preference for
// incremental, verified changes over speculative large ones (see the
// NumCompactors regression in this same file's project history).
const maxLiveConnections = 1000

func tooManyConnections() bool {
	return atomic.LoadInt64(&liveConnections) >= maxLiveConnections
}

// Confirmed by reading khatru's own handlers.go: a connection's main
// read-loop goroutine and its separate ping-ticker goroutine both
// independently `defer kill()`, which fires OnDisconnect twice per real
// disconnect (OnConnect only fires once). Verified live during load
// testing — without this guard, liveConnections drifted to -100 after
// 100 clients connected and disconnected. Deduplicated per-connection via
// khatru.GetConnection(ctx), which returns a stable pointer identifying
// the same WebSocket across both calls.
var (
	disconnectSeenMu sync.Mutex
	disconnectSeen   = map[*khatru.WebSocket]struct{}{}
)

// DVM job feedback/result kinds this relay might see pass through — see
// server/cmd/dvm/main.go for the full job-kind registry (5001->6001,
// 5002->6002, 5050->6050) plus the shared 7000 feedback kind.
var dvmResultKinds = map[int]bool{
	6001: true,
	6002: true,
	6050: true,
	7000: true,
}

func newHealthConnectHook() func(ctx context.Context) {
	return func(ctx context.Context) {
		atomic.AddInt64(&liveConnections, 1)
	}
}

func newHealthDisconnectHook() func(ctx context.Context) {
	return func(ctx context.Context) {
		conn := khatru.GetConnection(ctx)
		if conn == nil {
			return
		}
		disconnectSeenMu.Lock()
		_, alreadySeen := disconnectSeen[conn]
		if alreadySeen {
			delete(disconnectSeen, conn)
		} else {
			disconnectSeen[conn] = struct{}{}
		}
		disconnectSeenMu.Unlock()

		if alreadySeen {
			return
		}
		atomic.AddInt64(&liveConnections, -1)
	}
}

// Cheap, passive observer — NOT a definitive DVM liveness check (that's
// what .github/workflows/uptime-check.yml does, actively, on a schedule).
// This only reflects whether DVM-kind events have recently passed through
// this relay, which requires someone to have actually submitted a job;
// silence doesn't distinguish "DVM is down" from "nobody asked it
// anything." Surfaced in the dashboard with that caveat stated plainly.
func newHealthEventSavedHook() func(ctx context.Context, event *nostr.Event) {
	return func(ctx context.Context, event *nostr.Event) {
		if !dvmResultKinds[event.Kind] {
			return
		}
		atomic.AddInt64(&dvmEventTotal, 1)
		atomic.StoreInt64(&lastDvmEventAt, time.Now().Unix())
	}
}

type healthSnapshot struct {
	Version          string  `json:"version"`
	UptimeSeconds    int64   `json:"uptimeSeconds"`
	LiveConnections  int64   `json:"liveConnections"`
	Goroutines       int     `json:"goroutines"`
	MemAllocMB       float64 `json:"memAllocMB"`
	MemSysMB         float64 `json:"memSysMB"`
	DvmEventTotal    int64   `json:"dvmEventTotal"`
	LastDvmEventUnix int64   `json:"lastDvmEventUnix"`
}

func getHealthSnapshot() healthSnapshot {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	version := os.Getenv("NOSTRAS_VERSION")
	if version == "" {
		version = "dev"
	}
	return healthSnapshot{
		Version:          version,
		UptimeSeconds:    int64(time.Since(processStartedAt).Seconds()),
		LiveConnections:  atomic.LoadInt64(&liveConnections),
		Goroutines:       runtime.NumGoroutine(),
		MemAllocMB:       float64(m.Alloc) / 1024 / 1024,
		MemSysMB:         float64(m.Sys) / 1024 / 1024,
		DvmEventTotal:    atomic.LoadInt64(&dvmEventTotal),
		LastDvmEventUnix: atomic.LoadInt64(&lastDvmEventAt),
	}
}

// dvmHealthSnapshot mirrors the shape cmd/dvm/health.go actually serves —
// duplicated rather than shared, since the relay and DVM are separate
// binaries/packages with no common internal module between them (matching
// how this project already keeps main.go/cmd/dvm/main.go independent).
// Reachable is false (and every other field its zero value) whenever the
// fetch itself fails — the DVM being briefly unreachable over the private
// network shouldn't break the dashboard, just honestly report the gap,
// same degrade-gracefully posture as every other optional signal here
// (analytics geo lookup, DVM payment gating, etc.).
type dvmHealthSnapshot struct {
	// Reachable is the only field callers should branch on to distinguish
	// "DVM unreachable" from "DVM reachable, reporting a real false" — the
	// two bools below deliberately have no `omitempty` (which treats false
	// as the zero value and would drop the field entirely, indistinguishable
	// from it being absent because the fetch failed).
	Reachable      bool    `json:"reachable"`
	Version        string  `json:"version,omitempty"`
	UptimeSeconds  int64   `json:"uptimeSeconds,omitempty"`
	RelayConnected bool    `json:"relayConnected"`
	PaymentGating  bool    `json:"paymentGating"`
	JobsHandled    int64   `json:"jobsHandled,omitempty"`
	LastJobUnix    int64   `json:"lastJobUnix,omitempty"`
	Goroutines     int     `json:"goroutines,omitempty"`
	MemAllocMB     float64 `json:"memAllocMB,omitempty"`
	MemSysMB       float64 `json:"memSysMB,omitempty"`
	ModelBackend   string  `json:"modelBackend,omitempty"`
	Model          string  `json:"model,omitempty"`
	ModelPrivacy   string  `json:"modelPrivacy,omitempty"`
	// Cached on the DVM side (server/cmd/dvm/health.go), never fetched live
	// here — same reasoning as everywhere else in this file, a slow/blocked
	// external call must never make a health check itself look unhealthy.
	// Only meaningful when PaymentGating is true; WalletBalanceOK has no
	// omitempty for the same reason RelayConnected/PaymentGating above
	// don't.
	WalletBalanceSats   int64  `json:"walletBalanceSats,omitempty"`
	WalletBalanceOK     bool   `json:"walletBalanceOk"`
	WalletBalanceError  string `json:"walletBalanceError,omitempty"`
	WalletBalanceAtUnix int64  `json:"walletBalanceAtUnix,omitempty"`
}

var dvmHealthHTTPClient = &http.Client{Timeout: 2 * time.Second}

// fetchDvmHealth hits the DVM's own /health endpoint over Fly's private
// network (NOSTRAS_DVM_HEALTH_URL — same "<process>.process.<app>.internal"
// convention NOSTRAS_RELAY_URL already relies on for the DVM to reach the
// relay in the other direction). A short client timeout bounds worst-case
// latency on the dashboard request; any failure just yields Reachable:
// false rather than an error the caller has to handle.
func fetchDvmHealth(ctx context.Context) dvmHealthSnapshot {
	url := os.Getenv("NOSTRAS_DVM_HEALTH_URL")
	if url == "" {
		url = "http://localhost:7778/health"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return dvmHealthSnapshot{}
	}
	resp, err := dvmHealthHTTPClient.Do(req)
	if err != nil {
		return dvmHealthSnapshot{}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return dvmHealthSnapshot{}
	}

	var snap dvmHealthSnapshot
	if err := json.NewDecoder(resp.Body).Decode(&snap); err != nil {
		return dvmHealthSnapshot{}
	}
	snap.Reachable = true
	return snap
}
