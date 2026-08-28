package main

import (
	_ "embed"
	"net/http"
)

// Embedded at build time, same pattern as landing.go/why.go/node.go —
// the "Own Your Money" self-hosted Alby Hub onboarding guide. Served at
// "/wallet" (see main.go's route registration).
//
//go:embed wallet.html
var walletHTML []byte

func handleWallet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(walletHTML)
}
