package main

import (
	"context"
	"strings"
	"testing"

	"github.com/nbd-wtf/go-nostr"
)

func TestStoragePolicy(t *testing.T) {
	hook := newStoragePolicyRejectHook()
	ctx := context.Background()
	big := strings.Repeat("a", maxEventBytes)
	cases := []struct {
		name   string
		evt    *nostr.Event
		reject bool
	}{
		{"normal note", &nostr.Event{Kind: 1, Content: "hello"}, false},
		{"oversized note", &nostr.Event{Kind: 1, Content: big}, true},
		{"large follow list", &nostr.Event{Kind: 3, Content: big}, false},
		{"large article", &nostr.Event{Kind: 30023, Content: big}, false},
		{"large list kind", &nostr.Event{Kind: 10003, Content: big}, false},
		{"nym-sync wrap", &nostr.Event{Kind: 1059, Tags: nostr.Tags{{"k", "nym-sync"}, {"p", "x"}}, Content: "c"}, true},
		{"ordinary DM wrap", &nostr.Event{Kind: 1059, Tags: nostr.Tags{{"p", "x"}}, Content: "c"}, false},
	}
	for _, c := range cases {
		reject, msg := hook(ctx, c.evt)
		if reject != c.reject {
			t.Errorf("%s: reject=%v (%q), want %v", c.name, reject, msg, c.reject)
		}
	}
}
