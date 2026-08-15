package main

import (
	"encoding/json"
	"net/http"
)

type waitlistRequestBody struct {
	Email string `json:"email"`
	Note  string `json:"note"`
}

// handleWaitlistJoin is a public, unauthenticated endpoint (a visitor
// submitting interest, not a signed-in Nostr identity — nothing here
// to authenticate against) with no rate limiting of its own. Low
// stakes if abused: worst case is junk rows in a marketing list an
// operator reviews manually, not something that affects relay
// operation, so this deliberately doesn't carry the same hardening as
// e.g. the relay's own event-ingest path.
func handleWaitlistJoin(store *waitlistStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body waitlistRequestBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := store.add(body.Email, body.Note); err != nil {
			http.Error(w, "please enter a valid email address", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDashboardWaitlist(store *waitlistStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(store.snapshot())
	}
}
