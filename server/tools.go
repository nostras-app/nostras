package main

import (
	_ "embed"
	"net/http"
)

// Embedded at build time, same pattern as landing.go/why.go/node.go — the
// standalone "sell the DVM to everybody" pitch. Deliberately says nothing
// about relays or self-hosting: unlike /node (an infrastructure-hosting
// pitch that only makes sense to someone who already wants to run their
// own node), this page pitches the DVM's real, already-live NIP-90 AI
// jobs as a turnkey, pay-per-use service usable from any Nostr client —
// closer in shape to nostr.build's own self-serve model than to a
// managed-hosting sales conversation. Served at "/tools" (see main.go's
// route registration).
//
//go:embed tools.html
var toolsHTML []byte

func handleTools(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(toolsHTML)
}
