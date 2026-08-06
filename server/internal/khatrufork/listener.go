package khatru

import (
	"context"
	"errors"
	"slices"
	"sync"

	"github.com/nbd-wtf/go-nostr"
)

var ErrSubscriptionClosedByClient = errors.New("subscription closed by client")

// NOSTRAS PATCH: relay-wide cap on concurrent broadcast writes — see
// Relay.broadcastSem in relay.go and notifyListeners below.
const maxConcurrentBroadcastWrites = 200

type listenerSpec struct {
	id       string // kept here so we can easily match against it removeListenerId
	cancel   context.CancelCauseFunc
	index    int
	subrelay *Relay // this is important when we're dealing with routing, otherwise it will be always the same
}

type listener struct {
	id     string // duplicated here so we can easily send it on notifyListeners
	filter nostr.Filter
	ws     *WebSocket
}

func (rl *Relay) GetListeningFilters() []nostr.Filter {
	respfilters := make([]nostr.Filter, len(rl.listeners))
	for i, l := range rl.listeners {
		respfilters[i] = l.filter
	}
	return respfilters
}

// addListener may be called multiple times for each id and ws -- in which case each filter will
// be added as an independent listener
func (rl *Relay) addListener(
	ws *WebSocket,
	id string,
	subrelay *Relay,
	filter nostr.Filter,
	cancel context.CancelCauseFunc,
) {
	rl.clientsMutex.Lock()
	defer rl.clientsMutex.Unlock()

	if specs, ok := rl.clients[ws]; ok /* this will always be true unless client has disconnected very rapidly */ {
		idx := len(subrelay.listeners)
		rl.clients[ws] = append(specs, listenerSpec{
			id:       id,
			cancel:   cancel,
			subrelay: subrelay,
			index:    idx,
		})
		subrelay.listeners = append(subrelay.listeners, listener{
			ws:     ws,
			id:     id,
			filter: filter,
		})
	}
}

// remove a specific subscription id from listeners for a given ws client
// and cancel its specific context
func (rl *Relay) removeListenerId(ws *WebSocket, id string) {
	rl.clientsMutex.Lock()
	defer rl.clientsMutex.Unlock()

	if specs, ok := rl.clients[ws]; ok {
		// swap delete specs that match this id
		for s := len(specs) - 1; s >= 0; s-- {
			spec := specs[s]
			if spec.id == id {
				spec.cancel(ErrSubscriptionClosedByClient)
				specs[s] = specs[len(specs)-1]
				specs = specs[0 : len(specs)-1]
				rl.clients[ws] = specs

				// swap delete listeners one at a time, as they may be each in a different subrelay
				srl := spec.subrelay // == rl in normal cases, but different when this came from a route

				if spec.index != len(srl.listeners)-1 {
					movedFromIndex := len(srl.listeners) - 1
					moved := srl.listeners[movedFromIndex] // this wasn't removed, but will be moved
					srl.listeners[spec.index] = moved

					// now we must update the the listener we just moved
					// so its .index reflects its new position on srl.listeners
					movedSpecs := rl.clients[moved.ws]
					idx := slices.IndexFunc(movedSpecs, func(ls listenerSpec) bool {
						return ls.index == movedFromIndex && ls.subrelay == srl
					})
					movedSpecs[idx].index = spec.index
					rl.clients[moved.ws] = movedSpecs
				}
				srl.listeners = srl.listeners[0 : len(srl.listeners)-1] // finally reduce the slice length
			}
		}
	}
}

func (rl *Relay) removeClientAndListeners(ws *WebSocket) {
	rl.clientsMutex.Lock()
	defer rl.clientsMutex.Unlock()
	if specs, ok := rl.clients[ws]; ok {
		// swap delete listeners and delete client (all specs will be deleted)
		for s, spec := range specs {
			// no need to cancel contexts since they inherit from the main connection context
			// just delete the listeners (swap-delete)
			srl := spec.subrelay

			if spec.index != len(srl.listeners)-1 {
				movedFromIndex := len(srl.listeners) - 1
				moved := srl.listeners[movedFromIndex] // this wasn't removed, but will be moved
				srl.listeners[spec.index] = moved

				// temporarily update the spec of the listener being removed to have index == -1
				// (since it was removed) so it doesn't match in the search below
				rl.clients[ws][s].index = -1

				// now we must update the the listener we just moved
				// so its .index reflects its new position on srl.listeners
				movedSpecs := rl.clients[moved.ws]
				idx := slices.IndexFunc(movedSpecs, func(ls listenerSpec) bool {
					return ls.index == movedFromIndex && ls.subrelay == srl
				})
				movedSpecs[idx].index = spec.index
				rl.clients[moved.ws] = movedSpecs
			}
			srl.listeners = srl.listeners[0 : len(srl.listeners)-1] // finally reduce the slice length
		}
	}
	delete(rl.clients, ws)
}

// returns how many listeners were notified
//
// NOSTRAS PATCH: originally wrote to every matching listener sequentially,
// one at a time, on the caller's own goroutine, with no write deadline
// (Relay.WriteWait is defined upstream but was never actually applied via
// SetWriteDeadline anywhere in the package). That meant a single slow or
// stuck subscriber's blocking WriteJSON call could stall delivery to every
// other listener plus the publisher's own response, unbounded — confirmed
// under real load testing: sequential+unbounded produced multi-second (up
// to ~20s) publish latency and a ~37% failure rate at 500 concurrent
// subscribers, versus ~30ms median at 100.
//
// Fixed by dispatching each write concurrently with a bounded deadline
// (WriteJSONWithDeadline in websocket.go) AND a relay-wide concurrency cap
// (rl.broadcastSem) — an earlier version of this patch used fully
// unbounded per-broadcast goroutines, which in testing performed no
// better (and sometimes worse) under real resource pressure, since a
// burst of simultaneous publishes could each spawn hundreds of goroutines
// with no global limit, adding scheduling/GC overhead on top of the
// original problem instead of just fixing it. The semaphore keeps the
// fan-out concurrent (so one slow connection can't block the rest) while
// keeping total in-flight broadcast writes bounded regardless of how many
// publishes happen to land at once.
//
// `count` semantics are preserved exactly as before (counts every
// matched, non-prevented listener, regardless of whether its individual
// write ultimately succeeds) to avoid changing ephemeral-event "was
// anyone listening" behavior downstream.
func (rl *Relay) notifyListeners(event *nostr.Event) int {
	var wg sync.WaitGroup
	count := 0

listenersloop:
	for _, lsn := range rl.listeners {
		if !lsn.filter.Matches(event) {
			continue
		}
		for _, pb := range rl.PreventBroadcast {
			if pb(lsn.ws, event) {
				continue listenersloop
			}
		}
		count++

		wg.Add(1)
		rl.broadcastSem <- struct{}{}
		go func(l listener) {
			defer wg.Done()
			defer func() { <-rl.broadcastSem }()
			l.ws.WriteJSONWithDeadline(nostr.EventEnvelope{SubscriptionID: &l.id, Event: *event}, rl.WriteWait)
		}(lsn)
	}
	wg.Wait()

	return count
}
