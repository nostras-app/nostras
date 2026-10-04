package main

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/fiatjaf/eventstore"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/sdk"
)

// Outbox fetching without the SDK's SimplePool (2026-10-04, PQ-093
// follow-up). go-nostr v0.52.3's SimplePool.EnsureRelay never records a
// failed connection, so its penalty box never applies: every fetch
// re-dials a dead relay from scratch with a 15s timeout of its own,
// ignoring the caller's context, while holding a hashed lock that other
// fetches queue behind. A production goroutine dump showed 15 fetches
// queued behind one dial for over a minute, which is why outbox
// aggregation had effectively stopped.
//
// outboxRelays replaces it for author fetches: dials honor a short
// timeout of their own (callers stop waiting at their own deadline), a
// relay that fails is skipped for relayDeadFor, concurrent dials to the
// same relay are collapsed into one, and idle connections are closed.
// The SDK is still used for relay-list lookups (FetchOutboxRelays), which
// only talk to the three healthy bootstrap relays.

// Vars, not consts, so tests can shorten the dial timeout.
var (
	relayDialTimeout = 5 * time.Second
	relayDeadFor     = 5 * time.Minute
	relayIdleClose   = 5 * time.Minute
)

type pooledRelay struct {
	relay    *nostr.Relay
	lastUsed time.Time
}

type outboxRelays struct {
	// allowed decides whether a relay URL may be dialed at all. Author
	// relay lists are third-party data, so production uses
	// isSafeRelayURLForScan (no private, loopback or CGNAT addresses).
	allowed func(ctx context.Context, url string) bool
	dial    func(ctx context.Context, url string) (*nostr.Relay, error)

	mu        sync.Mutex
	conns     map[string]*pooledRelay
	dialing   map[string]chan struct{}
	deadUntil map[string]time.Time
}

func newOutboxRelays(allowed func(context.Context, string) bool) *outboxRelays {
	return &outboxRelays{
		allowed: allowed,
		dial: func(ctx context.Context, url string) (*nostr.Relay, error) {
			return nostr.RelayConnect(ctx, url)
		},
		conns:     map[string]*pooledRelay{},
		dialing:   map[string]chan struct{}{},
		deadUntil: map[string]time.Time{},
	}
}

var errRelayDead = errors.New("relay recently failed, skipping")

// get returns a connected relay, dialing it if needed. The dial runs on
// its own relayDialTimeout, detached from ctx, so a caller giving up early
// doesn't mark a healthy-but-slow relay as dead; the caller itself stops
// waiting at ctx's deadline.
func (p *outboxRelays) get(ctx context.Context, rawURL string) (*nostr.Relay, error) {
	url := nostr.NormalizeURL(rawURL)
	for {
		p.mu.Lock()
		if until, ok := p.deadUntil[url]; ok && time.Now().Before(until) {
			p.mu.Unlock()
			return nil, errRelayDead
		}
		if c, ok := p.conns[url]; ok && c.relay.IsConnected() {
			c.lastUsed = time.Now()
			p.mu.Unlock()
			return c.relay, nil
		}
		if wait, ok := p.dialing[url]; ok {
			p.mu.Unlock()
			select {
			case <-wait:
				continue // re-check: connected, or now marked dead
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		done := make(chan struct{})
		p.dialing[url] = done
		p.mu.Unlock()

		result := make(chan error, 1)
		go func() {
			dialCtx, cancel := context.WithTimeout(context.Background(), relayDialTimeout)
			defer cancel()
			var r *nostr.Relay
			var err error
			if p.allowed != nil && !p.allowed(dialCtx, url) {
				err = errors.New("relay address not allowed")
			} else {
				r, err = p.dial(dialCtx, url)
			}
			p.mu.Lock()
			delete(p.dialing, url)
			if err != nil {
				p.deadUntil[url] = time.Now().Add(relayDeadFor)
			} else {
				delete(p.deadUntil, url)
				p.conns[url] = &pooledRelay{relay: r, lastUsed: time.Now()}
			}
			p.mu.Unlock()
			close(done)
			result <- err
		}()

		select {
		case err := <-result:
			if err != nil {
				return nil, err
			}
			continue
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

// closeIdle drops connections unused for relayIdleClose and forgets
// expired dead marks, so neither map grows without bound.
func (p *outboxRelays) closeIdle() {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	for url, c := range p.conns {
		if !c.relay.IsConnected() || now.Sub(c.lastUsed) > relayIdleClose {
			c.relay.Close()
			delete(p.conns, url)
		}
	}
	for url, until := range p.deadUntil {
		if now.After(until) {
			delete(p.deadUntil, url)
		}
	}
}

func (p *outboxRelays) startJanitor() {
	go func() {
		for {
			time.Sleep(time.Minute)
			p.closeIdle()
		}
	}()
}

// newOutboxAuthorFetcher fetches one author's events from (up to two of)
// their outbox relays, in parallel, and saves each new event through the
// tracking store so it's cached and later evicted like the SDK's own
// writes. Returns whatever arrived before ctx's deadline.
func newOutboxAuthorFetcher(
	sys *sdk.System,
	relays *outboxRelays,
	store eventstore.Store,
	kinds []int,
	until nostr.Timestamp,
) authorFetcher {
	cache := eventstore.RelayWrapper{Store: store}
	return func(ctx context.Context, pubkey string, limit int) []*nostr.Event {
		urls := sys.FetchOutboxRelays(ctx, pubkey, 2)
		return fetchFromRelays(ctx, relays, urls, nostr.Filter{
			Authors: []string{pubkey},
			Kinds:   kinds,
			Until:   &until,
			Limit:   limit,
		}, func(evt *nostr.Event) {
			cache.Publish(context.Background(), *evt)
		})
	}
}

// fetchFromRelays queries each URL in parallel and merges results by id.
// save is called once per distinct event.
func fetchFromRelays(ctx context.Context, relays *outboxRelays, urls []string, filter nostr.Filter, save func(*nostr.Event)) []*nostr.Event {
	var mu sync.Mutex
	seen := map[string]bool{}
	var out []*nostr.Event
	var wg sync.WaitGroup
	for _, u := range urls {
		wg.Add(1)
		go func(u string) {
			defer wg.Done()
			r, err := relays.get(ctx, u)
			if err != nil {
				return
			}
			evs, _ := r.QuerySync(ctx, filter)
			mu.Lock()
			defer mu.Unlock()
			for _, e := range evs {
				if seen[e.ID] {
					continue
				}
				seen[e.ID] = true
				out = append(out, e)
				save(e)
			}
		}(u)
	}
	wg.Wait()
	return out
}
