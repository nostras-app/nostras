package main

import (
	"fmt"
	"net/http"
	"net/http/pprof"
)

// startPprofServer exposes Go's runtime profiler (heap, goroutine,
// allocation, CPU) on a private-network-only port. Added 2026-09-02,
// directly prompted by a real, recurring problem this project had no way
// to actually diagnose: the "web" machine has now been OOM-killed three
// separate times in about 24 hours (see NOSTRAS-CSV.md's PQ-064/PQ-065
// entries), and every single time, Fly's own OOM killer wiped the process
// — and every byte of evidence about what was actually holding the
// memory — before anyone could look. A restart "fixes" the symptom every
// time; nothing has ever actually looked at what's *in* the heap while
// it's climbing.
//
// This closes that gap going forward: SSH into the machine
// (flyctl ssh console) and hit http://localhost:<port>/debug/pprof/heap
// to save a real snapshot of exactly what's allocated at that moment —
// ideally caught partway through a climb, not after Fly has already
// cleaned up. `go tool pprof` (or pprof.me) can then show precisely
// which allocations dominate, real data instead of another guess.
//
// Registered on its own ServeMux, not http.DefaultServeMux — explicit
// on principle, so nothing else in this process could ever accidentally
// expose these routes by calling http.ListenAndServe(addr, nil)
// elsewhere. Bound to a port deliberately NOT declared in fly.toml's
// [http_service] block for "web", the same safety pattern already
// established for the DVM's own private health endpoint: Fly's proxy
// only ever routes public traffic to ports actually listed there, so
// this is reachable over the private 6PN network (SSH, or another
// process in this same app) but never from the public internet,
// regardless of what it listens on.
func startPprofServer(port string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	go func() {
		if err := http.ListenAndServe(":"+port, mux); err != nil {
			fmt.Println("pprof server failed:", err)
		}
	}()
}
