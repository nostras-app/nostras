package main

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/btcsuite/btcd/btcutil/bech32"
)

// Minimal BOLT11 amount parsing — a defensive sanity check that an
// invoice fetched from an author's own LNURL-pay callback (see
// lnurl.go) actually carries the amount this DVM asked for, not a
// security boundary in itself. (An earlier version of this file tried
// to use full BOLT11 decoding — payment_hash extraction plus signature
// recovery — as a way to verify a *client-submitted* invoice's
// authenticity. That was found and proven wrong via a real forged-
// invoice test: ECDSA signature *recovery* always succeeds for *some*
// public key given any (signature, message) pair, so "recovery didn't
// error" proves nothing about tampering unless you already know which
// key to expect. The actual fix was architectural, not cryptographic:
// this DVM now fetches the author's invoice itself, server-side, over
// HTTPS, directly from the domain in their own published lud16 — see
// lnurl.go — which is what genuinely establishes provenance. Only the
// amount-parsing half of the old decoder survives here.)
//
// bech32 decoding is already a transitive dependency via go-nostr's own
// nip19 (npub/nsec encoding uses the same
// github.com/btcsuite/btcd/btcutil/bech32 package), so this needs no
// new module.
//
// Spec: https://github.com/lightning/bolts/blob/master/11-payment-encoding.md

// bolt11Amount returns the invoice's amount in millisatoshis, parsed
// from the human-readable prefix (e.g. "lnbc210n" -> 21000).
func bolt11Amount(invoice string) (int64, error) {
	hrp, _, err := bech32.DecodeNoLimit(invoice)
	if err != nil {
		return 0, fmt.Errorf("invalid bech32: %w", err)
	}
	if len(hrp) < 4 || hrp[:2] != "ln" {
		return 0, errors.New("not a lightning invoice")
	}
	return parseBolt11Amount(hrp)
}

// parseBolt11Amount parses the optional amount+multiplier suffix from
// the invoice's human-readable part, e.g. "lnbc210n" -> 21000 msat. No
// suffix means "any amount" — rejected here since a sanity check needs
// a specific amount to compare against.
func parseBolt11Amount(hrp string) (int64, error) {
	i := 2
	for i < len(hrp) && (hrp[i] < '0' || hrp[i] > '9') {
		i++
	}
	if i >= len(hrp) {
		return 0, errors.New("invoice has no amount")
	}
	j := i
	for j < len(hrp) && hrp[j] >= '0' && hrp[j] <= '9' {
		j++
	}
	amount, err := strconv.ParseInt(hrp[i:j], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid amount: %w", err)
	}
	if j >= len(hrp) {
		return amount * 100_000_000_000, nil // whole BTC
	}
	switch hrp[j] {
	case 'm':
		return amount * 100_000_000, nil
	case 'u':
		return amount * 100_000, nil
	case 'n':
		return amount * 100, nil
	case 'p':
		if amount%10 != 0 {
			return 0, errors.New("invalid pico amount")
		}
		return amount / 10, nil
	default:
		return 0, fmt.Errorf("unknown amount multiplier %q", string(hrp[j]))
	}
}
