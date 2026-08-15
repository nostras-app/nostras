package main

import (
	_ "embed"
	"net/http"
)

// Embedded at build time, same pattern as landing.go/why.go/node.go —
// the public "live usage stats" page. Deliberately a separate page
// rather than stripping auth off the existing operator dashboard.html:
// that page also embeds real operational surfaces (live server/DVM
// health, and now the waitlist panel with real visitor emails) that
// must stay private. A dedicated public page whose own template
// contains zero gated data is safer by construction than any amount of
// conditional show/hide logic layered onto the one page trying to
// serve both audiences. Served at "/stats" — see main.go's route
// registration, which also makes GET /dashboard/data itself public
// (the same aggregate, no-PII data this page's own JS fetches), while
// GET /dashboard, /dashboard/health, and /dashboard/waitlist all stay
// exactly as password-gated as before.
//
//go:embed stats.html
var statsHTML []byte

func handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(statsHTML)
}
