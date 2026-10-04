//go:build !race

package main

import (
	"context"
	"testing"
	"time"
)

// Excluded under -race: nostr.Relay.Close (go-nostr v0.52.3, relay.go:576)
// reads r.Connection while the relay's own ping goroutine sets it to nil
// (relay.go:175). That race is inside the library and is hit by any Close
// call, including the library's own pool; it's not in this code.

// Connections are reused, and idle ones get closed.
func TestOutboxRelaysReuseAndIdle(t *testing.T) {
	good := startTestRelay(t, signedNotes(t, 1))
	p := newOutboxRelays(allowAll)
	r1, err := p.get(context.Background(), good)
	if err != nil {
		t.Fatal(err)
	}
	r2, _ := p.get(context.Background(), good)
	if r1 != r2 {
		t.Error("second get opened a new connection")
	}
	old := relayIdleClose
	relayIdleClose = 0
	defer func() { relayIdleClose = old }()
	time.Sleep(5 * time.Millisecond)
	p.closeIdle()
	p.mu.Lock()
	n := len(p.conns)
	p.mu.Unlock()
	if n != 0 {
		t.Errorf("%d idle connections left open", n)
	}
}
