package main

import (
	"context"
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
// bound-it-and-degrade-gracefully approach as outboxSem/broadcastSem
// elsewhere in this codebase: past this many concurrent connections, new
// ones are refused with a clean 429 (via khatru's RejectConnection hook,
// which runs before the WebSocket upgrade) rather than accepted and left
// to starve the machine an existing client's publish/query depends on.
const maxLiveConnections = 200

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
