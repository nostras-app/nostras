package main

import (
	"encoding/json"
	"net/http"
)

type subscribeRequestBody struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// maxPushBodyBytes bounds the raw request body before JSON decoding — a
// real web push endpoint URL + P256dh/Auth keys are all short base64/URL
// strings, well under 1KB in practice. NIP-98 auth (required on both
// handlers below) is a real but cheap barrier — anyone can mint a fresh
// Nostr keypair for free, so this cap matters even though the endpoint
// isn't fully anonymous. Found during a security review (2026-09-01).
const maxPushBodyBytes = 8 << 10

func handlePushSubscribe(store *pushStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pubkey, ok := verifyNip98(r)
		if !ok {
			http.Error(w, "invalid or missing NIP-98 authorization", http.StatusUnauthorized)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxPushBodyBytes)
		var body subscribeRequestBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body.Endpoint == "" || body.Keys.P256dh == "" || body.Keys.Auth == "" {
			http.Error(w, "invalid subscription payload", http.StatusBadRequest)
			return
		}

		sub := pushSubscription{Endpoint: body.Endpoint, P256dh: body.Keys.P256dh, Auth: body.Keys.Auth}
		if err := store.add(pubkey, sub); err != nil {
			http.Error(w, "failed to save subscription", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func handlePushUnsubscribe(store *pushStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pubkey, ok := verifyNip98(r)
		if !ok {
			http.Error(w, "invalid or missing NIP-98 authorization", http.StatusUnauthorized)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxPushBodyBytes)
		var body struct {
			Endpoint string `json:"endpoint"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" {
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}

		if err := store.remove(pubkey, body.Endpoint); err != nil {
			http.Error(w, "failed to remove subscription", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
