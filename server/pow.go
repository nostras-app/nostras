package main

import (
	"context"
	"strconv"

	"github.com/nbd-wtf/go-nostr"
)

// countLeadingZeroBits implements NIP-13's difficulty definition exactly:
// the number of leading zero bits in the event id's hex representation.
// Each hex digit contributes 4 bits; a non-zero digit contributes
// however many of its own leading bits are zero before the first set
// bit (e.g. "2" = 0010 contributes 2 more, then counting stops).
func countLeadingZeroBits(hexID string) int {
	bits := 0
	for _, c := range hexID {
		var nibble int
		switch {
		case c >= '0' && c <= '9':
			nibble = int(c - '0')
		case c >= 'a' && c <= 'f':
			nibble = int(c-'a') + 10
		case c >= 'A' && c <= 'F':
			nibble = int(c-'A') + 10
		default:
			return bits
		}
		if nibble == 0 {
			bits += 4
			continue
		}
		for shift := 3; shift >= 0; shift-- {
			if nibble&(1<<shift) != 0 {
				break
			}
			bits++
		}
		break
	}
	return bits
}

// newMinPowRejectEventHook enforces a minimum NIP-13 proof-of-work
// difficulty on every incoming event. Difficulty is measured directly
// from the event's own id (already computed and signature-verified by
// khatru/go-nostr before any RejectEvent hook runs) — this never trusts
// a client-claimed "nonce" target tag, only the actual leading zero
// bits of the real id. minDifficulty <= 0 means this hook is never
// registered at all (see main.go) — an open relay shouldn't silently
// start rejecting every existing publish path (Composer, DVM results,
// etc., none of which mine PoW) just because this feature exists in
// the code.
func newMinPowRejectEventHook(minDifficulty int) func(ctx context.Context, evt *nostr.Event) (bool, string) {
	return func(_ context.Context, evt *nostr.Event) (bool, string) {
		if countLeadingZeroBits(evt.ID) < minDifficulty {
			return true, "pow: difficulty " + strconv.Itoa(minDifficulty) + " is required"
		}
		return false, ""
	}
}
