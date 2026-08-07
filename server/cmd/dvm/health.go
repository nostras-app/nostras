package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"runtime"
	"sync/atomic"
	"time"
)

// The DVM has never had any health reporting of its own — the operator
// dashboard (server/dashboard.go) only ever reported the *relay* process's
// own runtime stats, plus a passive "have I seen a DVM-kind event pass
// through" signal that can't distinguish "DVM is down" from "nobody asked
// it anything." This gives the DVM real self-reported metrics (uptime,
// memory, goroutines, jobs handled, its own connection status to the
// relay it depends on), fetched by the relay over Fly's private network
// and merged into the same dashboard — never exposed publicly itself,
// consistent with this process group having no [http_service] in
// fly.toml at all.
var (
	dvmStartedAt   = time.Now()
	dvmJobsHandled int64
	dvmLastJobUnix int64 // unix seconds; 0 = no job handled since boot
	dvmRelayUp     int32 // atomic bool: 1 = currently connected to the relay
)

func markRelayConnected(connected bool) {
	v := int32(0)
	if connected {
		v = 1
	}
	atomic.StoreInt32(&dvmRelayUp, v)
}

// Called at the top of handleJob, once per job request received — proof
// the DVM is actively subscribed and receiving real traffic, regardless
// of whether that particular job goes on to complete, get declined for
// payment, or error out.
func markJobReceived() {
	atomic.AddInt64(&dvmJobsHandled, 1)
	atomic.StoreInt64(&dvmLastJobUnix, time.Now().Unix())
}

type dvmHealthSnapshot struct {
	Version        string  `json:"version"`
	UptimeSeconds  int64   `json:"uptimeSeconds"`
	RelayConnected bool    `json:"relayConnected"`
	PaymentGating  bool    `json:"paymentGating"`
	JobsHandled    int64   `json:"jobsHandled"`
	LastJobUnix    int64   `json:"lastJobUnix"`
	Goroutines     int     `json:"goroutines"`
	MemAllocMB     float64 `json:"memAllocMB"`
	MemSysMB       float64 `json:"memSysMB"`
}

// startHealthServer runs in a goroutine for the DVM process's whole
// lifetime. Binds to all interfaces, same as the relay's own HTTP server
// — safe because this process group has no [http_service] block in
// fly.toml, so nothing routes public traffic to it regardless of what it
// listens on; only Fly's private network (6PN) can reach it, the same
// path NOSTRAS_RELAY_URL already relies on for the DVM to reach the
// relay in the other direction.
func startHealthServer(port string, paymentGatingOn bool) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		version := os.Getenv("NOSTRAS_VERSION")
		if version == "" {
			version = "dev"
		}
		snap := dvmHealthSnapshot{
			Version:        version,
			UptimeSeconds:  int64(time.Since(dvmStartedAt).Seconds()),
			RelayConnected: atomic.LoadInt32(&dvmRelayUp) == 1,
			PaymentGating:  paymentGatingOn,
			JobsHandled:    atomic.LoadInt64(&dvmJobsHandled),
			LastJobUnix:    atomic.LoadInt64(&dvmLastJobUnix),
			Goroutines:     runtime.NumGoroutine(),
			MemAllocMB:     float64(m.Alloc) / 1024 / 1024,
			MemSysMB:       float64(m.Sys) / 1024 / 1024,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(snap)
	})

	go func() {
		if err := http.ListenAndServe(":"+port, mux); err != nil {
			log.Println("dvm health server error:", err)
		}
	}()
}
