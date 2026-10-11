package main

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/nbd-wtf/go-nostr"
)

// What this relay agrees to store from anyone (2026-10-11, owner decision
// after PQ-094). Most of /data was other apps' data, not NOSTRAS's.
//
//  1. Nymchat sync data: kind 1059 gift wraps tagged ["k","nym-sync"].
//     They're another app's private backups, rewritten on every sync,
//     and were the single biggest consumer of space (see nymsync.go).
//  2. Event size: 64KB by default. Kinds that legitimately grow large
//     (follow lists and other list kinds, long-form articles, paid-unlock
//     results) may use up to khatru's own 512KB message limit.
const maxEventBytes = 64 * 1024

func allowsLargeEvent(kind int) bool {
	switch kind {
	case 3, 30023, 30024, 6904:
		return true
	}
	return (kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000)
}

func isNymSyncWrap(evt *nostr.Event) bool {
	if evt.Kind != 1059 {
		return false
	}
	for _, t := range evt.Tags {
		if len(t) >= 2 && t[0] == "k" && t[1] == "nym-sync" {
			return true
		}
	}
	return false
}

func newStoragePolicyRejectHook() func(ctx context.Context, evt *nostr.Event) (bool, string) {
	return func(_ context.Context, evt *nostr.Event) (bool, string) {
		if isNymSyncWrap(evt) {
			return true, "blocked: this relay doesn't store app sync data"
		}
		if allowsLargeEvent(evt.Kind) {
			return false, ""
		}
		raw, err := json.Marshal(evt)
		if err == nil && len(raw) > maxEventBytes {
			return true, "invalid: event too large (" + strconv.Itoa(len(raw)) + " bytes, limit " +
				strconv.Itoa(maxEventBytes) + " for kind " + strconv.Itoa(evt.Kind) + ")"
		}
		return false, ""
	}
}
