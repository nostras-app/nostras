package main

import (
	"context"
	"net"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fiatjaf/eventstore/slicestore"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

// startTestRelay runs a real in-process relay holding the given events.
func startTestRelay(t *testing.T, events []nostr.Event) string {
	t.Helper()
	store := &slicestore.SliceStore{}
	store.Init()
	for i := range events {
		store.SaveEvent(context.Background(), &events[i])
	}
	rl := khatru.NewRelay()
	rl.QueryEvents = append(rl.QueryEvents, store.QueryEvents)
	srv := httptest.NewServer(rl)
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

// startBlackHole accepts TCP connections and never answers: the dead or
// overloaded relay that stalled production.
func startBlackHole(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var held []net.Conn
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			held = append(held, c)
			mu.Unlock()
		}
	}()
	t.Cleanup(func() {
		ln.Close()
		mu.Lock()
		for _, c := range held {
			c.Close()
		}
		mu.Unlock()
	})
	return "ws://" + ln.Addr().String()
}

func signedNotes(t *testing.T, n int) []nostr.Event {
	sk := nostr.GeneratePrivateKey()
	out := make([]nostr.Event, n)
	for i := range out {
		out[i] = nostr.Event{Kind: 1, Content: "note " + string(rune('a'+i)), CreatedAt: nostr.Timestamp(1700000000 + i)}
		out[i].Sign(sk)
	}
	return out
}

func allowAll(context.Context, string) bool { return true }

// A healthy relay's events come back at once even when another of the
// author's relays is a black hole; the black hole is then skipped
// instantly instead of being re-dialed.
func TestFetchFromRelaysDeadRelayDoesNotStall(t *testing.T) {
	old := relayDialTimeout
	relayDialTimeout = 300 * time.Millisecond
	defer func() { relayDialTimeout = old }()

	notes := signedNotes(t, 3)
	good := startTestRelay(t, notes)
	hole := startBlackHole(t)
	p := newOutboxRelays(allowAll)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var saved atomic.Int32
	start := time.Now()
	got := fetchFromRelays(ctx, p, []string{good, hole}, nostr.Filter{Kinds: []int{1}, Limit: 10},
		func(*nostr.Event) { saved.Add(1) })
	if len(got) != 3 || saved.Load() != 3 {
		t.Fatalf("got %d events, saved %d; want 3 and 3", len(got), saved.Load())
	}
	if d := time.Since(start); d > time.Second {
		t.Errorf("took %s; the black hole should cost at most the 300ms dial timeout", d)
	}

	start = time.Now()
	if _, err := p.get(context.Background(), hole); err != errRelayDead {
		t.Errorf("black hole: got %v, want errRelayDead", err)
	}
	if d := time.Since(start); d > 50*time.Millisecond {
		t.Errorf("dead relay check took %s, should be instant", d)
	}
}

// Many fetches to the same relay share one dial (the production queue
// was many fetches re-dialing the same dead relay one after another).
func TestOutboxRelaysSingleDial(t *testing.T) {
	old := relayDialTimeout
	relayDialTimeout = 300 * time.Millisecond
	defer func() { relayDialTimeout = old }()

	hole := startBlackHole(t)
	p := newOutboxRelays(allowAll)
	var dials atomic.Int32
	real := p.dial
	p.dial = func(ctx context.Context, url string) (*nostr.Relay, error) {
		dials.Add(1)
		return real(ctx, url)
	}

	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			p.get(ctx, hole)
		}()
	}
	wg.Wait()
	if dials.Load() != 1 {
		t.Errorf("dialed %d times, want 1", dials.Load())
	}
	if d := time.Since(start); d > time.Second {
		t.Errorf("10 waiters took %s, want ~one dial timeout", d)
	}
}

// A caller with a short deadline gives up on time without waiting for
// the dial.
func TestOutboxRelaysCallerDeadline(t *testing.T) {
	hole := startBlackHole(t)
	p := newOutboxRelays(allowAll) // default 5s dial timeout
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := p.get(ctx, hole); err == nil {
		t.Fatal("expected an error")
	}
	if d := time.Since(start); d > 300*time.Millisecond {
		t.Errorf("caller waited %s past its 100ms deadline", d)
	}
}

// Disallowed addresses are never dialed.
func TestOutboxRelaysNotAllowed(t *testing.T) {
	p := newOutboxRelays(func(context.Context, string) bool { return false })
	dialed := false
	p.dial = func(context.Context, string) (*nostr.Relay, error) { dialed = true; return nil, nil }
	if _, err := p.get(context.Background(), "ws://127.0.0.1:1"); err == nil || dialed {
		t.Errorf("err=%v dialed=%v; want an error and no dial", err, dialed)
	}
}

// The production allow check rejects loopback and private addresses.
func TestOutboxRelaysProductionGuard(t *testing.T) {
	for _, u := range []string{"ws://127.0.0.1:7777", "ws://10.0.0.5", "ws://localhost:7777", "ws://web.process.nostras.internal:7777"} {
		if isSafeRelayURLForScan(context.Background(), u) {
			t.Errorf("%s allowed, want rejected", u)
		}
	}
}
