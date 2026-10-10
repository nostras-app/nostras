package main

import (
	"context"
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

// Operator wallet balance is polled in the background on a slow interval
// and cached here, never fetched live inside the /health handler itself —
// the relay's own dvmHealthHTTPClient (server/health.go) has a hard 2s
// timeout on the whole /health request, and a real NWC round trip (publish
// a request event, wait for the wallet's own relay to answer) routinely
// takes longer than that even when everything is healthy. A slow balance
// check must never make /health itself look like the DVM is down.
var (
	dvmWalletBalanceMsat   int64        // last known good value; 0 with dvmWalletBalanceOK=false means never succeeded
	dvmWalletBalanceOK     int32        // atomic bool: 1 = last poll succeeded
	dvmWalletBalanceErr    atomic.Value // string
	dvmWalletBalanceAtUnix int64        // unix seconds of the last successful poll
)

// startWalletBalancePoller runs for the DVM process's whole lifetime,
// refreshing the cached balance every 2 minutes — balance doesn't need to
// be near-real-time for a health display, and polling less aggressively
// avoids hammering the wallet's own relay/service. A no-op if payment
// gating is off (no wallet configured at all).
func startWalletBalancePoller(nwc *nwcClient) {
	if nwc == nil {
		return
	}
	dvmWalletBalanceErr.Store("")
	poll := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		balance, err := nwc.GetBalance(ctx)
		if err != nil {
			dvmWalletBalanceErr.Store(err.Error())
			atomic.StoreInt32(&dvmWalletBalanceOK, 0)
			return
		}
		atomic.StoreInt64(&dvmWalletBalanceMsat, balance)
		atomic.StoreInt32(&dvmWalletBalanceOK, 1)
		atomic.StoreInt64(&dvmWalletBalanceAtUnix, time.Now().Unix())
		dvmWalletBalanceErr.Store("")
	}
	go func() {
		poll()
		ticker := time.NewTicker(2 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			poll()
		}
	}()
}

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
	// Which model backend answers text jobs (see llm.go), and who can
	// see the job text once forwarded to it.
	ModelBackend string `json:"modelBackend"`
	Model        string `json:"model"`
	ModelPrivacy string `json:"modelPrivacy"`
	// Wallet* fields are only meaningful when PaymentGating is true —
	// callers must check that first, same as this struct's own established
	// pattern elsewhere (see server/health.go's dvmHealthSnapshot comment
	// on why Reachable is the required gate there). WalletBalanceOK
	// deliberately has no omitempty, matching RelayConnected/PaymentGating
	// above — dropping a real `false` (the poll genuinely failed) would be
	// indistinguishable from the field never having been set. WalletBalanceOK
	// false with WalletBalanceError set most commonly means the operator's
	// NWC connection was never granted a balance-read permission (it's
	// scoped to invoice create/lookup only by design) — not necessarily a
	// real problem.
	WalletBalanceSats   int64  `json:"walletBalanceSats,omitempty"`
	WalletBalanceOK     bool   `json:"walletBalanceOk"`
	WalletBalanceError  string `json:"walletBalanceError,omitempty"`
	WalletBalanceAtUnix int64  `json:"walletBalanceAtUnix,omitempty"`
}

// startHealthServer runs in a goroutine for the DVM process's whole
// lifetime. Binds to all interfaces, same as the relay's own HTTP server
// — safe because this process group has no [http_service] block in
// fly.toml, so nothing routes public traffic to it regardless of what it
// listens on; only Fly's private network (6PN) can reach it, the same
// path NOSTRAS_RELAY_URL already relies on for the DVM to reach the
// relay in the other direction.
func startHealthServer(port string, payment *paymentConfig, llm llmBackend) {
	paymentGatingOn := payment != nil
	if payment != nil {
		startWalletBalancePoller(payment.nwc)
	}

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
			ModelBackend:   llm.Name(),
			Model:          llm.Model(),
			ModelPrivacy:   llm.Privacy(),
		}
		if paymentGatingOn {
			snap.WalletBalanceOK = atomic.LoadInt32(&dvmWalletBalanceOK) == 1
			if snap.WalletBalanceOK {
				snap.WalletBalanceSats = atomic.LoadInt64(&dvmWalletBalanceMsat) / 1000
				snap.WalletBalanceAtUnix = atomic.LoadInt64(&dvmWalletBalanceAtUnix)
			} else if errStr, _ := dvmWalletBalanceErr.Load().(string); errStr != "" {
				snap.WalletBalanceError = errStr
			}
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
