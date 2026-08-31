package main

import (
	"encoding/json"
	"net/http"
)

type waitlistRequestBody struct {
	Email string `json:"email"`
	Note  string `json:"note"`
}

// maxWaitlistBodyBytes bounds the raw request body *before* JSON decoding
// even starts — store.add()'s own maxWaitlistNoteLen truncation (waitlist.go)
// only runs after the whole body is already in memory, which does nothing
// to stop a large POST from being fully read/allocated first. Found during
// a security review (2026-09-01): this endpoint is public/unauthenticated
// and accepted a real 100KB test payload with no rejection. 8KB is
// generous for an email + a note that's capped at 1000 chars anyway.
const maxWaitlistBodyBytes = 8 << 10

// handleWaitlistJoin is a public, unauthenticated endpoint (a visitor
// submitting interest, not a signed-in Nostr identity — nothing here
// to authenticate against) with no rate limiting of its own. Low
// stakes if abused: worst case is junk rows in a marketing list an
// operator reviews manually, not something that affects relay
// operation, so this deliberately doesn't carry the same hardening as
// e.g. the relay's own event-ingest path — except for the body-size
// cap above, which matters regardless of how low-stakes the data is.
func handleWaitlistJoin(store *waitlistStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxWaitlistBodyBytes)
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
