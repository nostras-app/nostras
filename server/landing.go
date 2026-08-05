package main

import (
	_ "embed"
	"net/http"
)

// Embedded at build time so the binary is self-contained — no separate
// static-file deploy step, consistent with how this relay has no other
// asset dependencies. Served only at the exact root path (see main.go's
// route registration, "GET /{$}") — everything else (WS upgrades, NIP-11
// requests, /push/*) is already routed elsewhere in khatru's ServeHTTP
// before this is ever reached.
//
//go:embed landing.html
var landingHTML []byte

func handleLanding(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(landingHTML)
}
