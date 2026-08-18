package main

import (
	"crypto/subtle"
	_ "embed"
	"encoding/json"
	"net/http"
)

//go:embed dashboard.html
var dashboardHTML []byte

// Basic Auth against a single shared secret (NOSTRAS_DASHBOARD_PASSWORD) —
// no accounts, no sessions, consistent with the rest of this relay's
// env-var-driven config. Username is ignored; only the password matters.
// subtle.ConstantTimeCompare avoids a timing side-channel on the
// comparison — cheap to do right even though the practical exposure here
// is small.
func requireDashboardAuth(password string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if password == "" {
			http.Error(w, "dashboard not configured", http.StatusServiceUnavailable)
			return
		}
		_, pass, ok := r.BasicAuth()
		if !ok || subtle.ConstantTimeCompare([]byte(pass), []byte(password)) != 1 {
			w.Header().Set("WWW-Authenticate", `Basic realm="NOSTRAS Dashboard"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func handleDashboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(dashboardHTML)
}

func handleDashboardData(store *analyticsStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(store.snapshot())
	}
}

// Real per-page landing-page traffic, deliberately admin-only — unlike
// the connection/country analytics in handleDashboardData, this was
// briefly public (shipped that way 2026-08-16, following the same
// "operator-visible usage data should be public" reasoning already
// applied to connection counts) and then explicitly reconsidered:
// the user asked for it moved behind the same auth gate as the
// waitlist. Kept as its own endpoint, same shape as
// handleDashboardWaitlist, rather than folded back into
// handleDashboardData behind a conditional — a public/private split at
// the endpoint level is harder to accidentally regress than a runtime
// check inside a handler shared by both a public and a gated page.
func handleDashboardPageViews(pageViews *pageViewStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(pageViews.snapshot())
	}
}

func handleDashboardHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		healthSnapshot
		Dvm dvmHealthSnapshot `json:"dvm"`
	}{
		healthSnapshot: getHealthSnapshot(),
		// Bounded by fetchDvmHealth's own 2s client timeout regardless of
		// r.Context()'s own deadline, so a slow/unreachable DVM never makes
		// this whole dashboard request hang.
		Dvm: fetchDvmHealth(r.Context()),
	})
}
