package main

import (
	_ "embed"
	"net/http"
)

// Embedded at build time, same pattern as landing.go/why.go — the
// NOSTRAS Node waitlist page. Served at "/node" (see main.go's route
// registration); its own form POSTs to "/node/waitlist" (waitlist.go/
// waitlist_handlers.go).
//
//go:embed node.html
var nodeHTML []byte

func handleNode(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(nodeHTML)
}
