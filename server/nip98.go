package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

const nip98AuthEventKind = 27235

// go-nostr (v0.52.3, this project's version) doesn't ship a nip98 package,
// so this is a small hand-rolled verifier per the NIP-98 spec: an
// Authorization: Nostr <base64 kind:27235 event> header, signed by the
// caller, proving they hold the private key for the pubkey they're acting
// as — used to gate push-subscription registration so a stranger can't
// register a subscription claiming to be someone else's pubkey and start
// receiving their notification metadata (who mentioned/DMed/zapped them).
//
// Deliberately checks the request PATH (not the full URL) against the
// event's "u" tag, not scheme+host — this app runs behind Fly's proxy,
// where the Host the server sees can differ from the public-facing one the
// client actually signed against. The signature + timestamp + pubkey
// ownership are the properties that matter for this endpoint (it only
// registers a device, no destructive action); exact URL matching is what
// NIP-98 recommends for stricter request-tampering resistance, not
// required for this to be a meaningful ownership proof.
func verifyNip98(r *http.Request) (pubkey string, ok bool) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Nostr ") {
		return "", false
	}

	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(auth, "Nostr "))
	if err != nil {
		return "", false
	}

	var evt nostr.Event
	if err := json.Unmarshal(raw, &evt); err != nil {
		return "", false
	}

	if evt.Kind != nip98AuthEventKind {
		return "", false
	}

	valid, err := evt.CheckSignature()
	if err != nil || !valid {
		return "", false
	}

	age := time.Since(evt.CreatedAt.Time())
	if age < -60*time.Second || age > 60*time.Second {
		return "", false // stale or future-dated — replay protection
	}

	var pathOK, methodOK bool
	for _, tag := range evt.Tags {
		if len(tag) < 2 {
			continue
		}
		if tag[0] == "u" && strings.HasSuffix(tag[1], r.URL.Path) {
			pathOK = true
		}
		if tag[0] == "method" && strings.EqualFold(tag[1], r.Method) {
			methodOK = true
		}
	}
	if !pathOK || !methodOK {
		return "", false
	}

	return evt.PubKey, true
}
