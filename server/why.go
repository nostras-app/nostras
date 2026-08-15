package main

import (
	_ "embed"
	"net/http"
)

// Embedded at build time, same pattern as landing.go — a static
// "why NOSTRAS" page listing real Nostr events cross-client tested
// against Yakihonne, plus the two payment mechanisms unique to this
// project. Served at the exact path "/why" (see main.go's route
// registration); no other route depends on this file.
//
//go:embed why.html
var whyHTML []byte

func handleWhy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(whyHTML)
}
