package main

import (
	"context"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

// Lock-free (sync/atomic only, no mutex) — OnConnect/OnDisconnect run per
// connection and OnEventSaved runs in the same hot path as every event
// this relay stores, so these hooks must stay trivially cheap. This is
// the same lesson the push-notification lock-contention outage taught the
// hard way (see CLAUDE.md) — applied proactively here instead.
var (
	processStartedAt = time.Now()
	liveConnections  int64
	dvmEventTotal    int64
	lastDvmEventAt   int64 // unix seconds; 0 = never observed since boot
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
	return healthSnapshot{
		UptimeSeconds:    int64(time.Since(processStartedAt).Seconds()),
		LiveConnections:  atomic.LoadInt64(&liveConnections),
		Goroutines:       runtime.NumGoroutine(),
		MemAllocMB:       float64(m.Alloc) / 1024 / 1024,
		MemSysMB:         float64(m.Sys) / 1024 / 1024,
		DvmEventTotal:    atomic.LoadInt64(&dvmEventTotal),
		LastDvmEventUnix: atomic.LoadInt64(&lastDvmEventAt),
	}
}
