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

func handleDashboardHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(getHealthSnapshot())
}
