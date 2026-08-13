package main

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

// NIP-43 Relay Access Metadata and Requests. NOSTRAS's relay is
// deliberately open (see CLAUDE.md's key-decisions section) — this does
// NOT add any gating. It's real, honest protocol participation on top of
// an already-open relay: any NIP-43-aware client can send a kind:28934
// "join request" and get formally, immediately recorded as a member (no
// invite code required, since there's nothing to invite past — everyone
// already has full read/write access), with a real kind:8000
// confirmation and a real, queryable kind:13534 membership roster.
// kind:28935 (relay-generated invite codes) is deliberately not
// implemented: the spec itself says a relay must "explicitly opt-in" to
// minting invite codes, and an open relay has no reason to — there's no
// admission decision an invite code could gate.
//
// Off by default: NOSTRAS_RELAY_PRIVATE_KEY (hex secret key) must be set
// for this relay to have a stable signing identity of its own — unset
// means the feature doesn't activate at all (not advertised in NIP-11,
// no hooks registered), same safe-by-default posture as the dashboard
// password, NIP-86 admin pubkey, and VAPID keys. This is the first
// place in this codebase where the relay itself signs and publishes
// Nostr events (rather than only reacting to client-published ones), so
// getting a stable identity right matters — a randomly-regenerated key
// on every boot would make membership look like it reset on every
// restart, defeating the point.
//
// Membership needs no separate JSON store: kind:8000 (member added) and
// kind:8001 (member removed) are real, stored (non-ephemeral) Nostr
// events per NIP-01's own kind-range convention (1000-9999 = regular),
// so the current member set is derived by replaying them chronologically
// from badger at boot — the same "replay a real event history into an
// in-memory cache" pattern already used for NIP-29 group admin state
// (nip29.go).

const (
	kindNip43Roles       = 33534
	kindNip43Members     = 13534
	kindNip43MemberAdded = 8000
	kindNip43MemberLeft  = 8001
	kindNip43JoinRequest = 28934
	kindNip43LeaveReq    = 28936
)

type nip43Cache struct {
	mu      sync.RWMutex
	members map[string]bool
}

func newNip43Cache() *nip43Cache {
	return &nip43Cache{members: map[string]bool{}}
}

// loadFromStore replays this relay's own kind:8000/8001 history in
// chronological order — mirrors nip29Cache.loadFromStore's own boot-scan
// precedent exactly, so a restart never needs re-joining to restore
// state.
func (c *nip43Cache) loadFromStore(ctx context.Context, db *badger.BadgerBackend, relayPubkey string) error {
	ch, err := db.QueryEvents(ctx, nostr.Filter{
		Kinds:   []int{kindNip43MemberAdded, kindNip43MemberLeft},
		Authors: []string{relayPubkey},
	})
	if err != nil {
		return err
	}
	events := make([]*nostr.Event, 0)
	for evt := range ch {
		events = append(events, evt)
	}
	sort.Slice(events, func(i, j int) bool { return events[i].CreatedAt < events[j].CreatedAt })

	c.mu.Lock()
	defer c.mu.Unlock()
	for _, evt := range events {
		p := evt.Tags.Find("p")
		if p == nil || len(p) < 2 {
			continue
		}
		if evt.Kind == kindNip43MemberAdded {
			c.members[p[1]] = true
		} else {
			delete(c.members, p[1])
		}
	}
	return nil
}

func (c *nip43Cache) isMember(pubkey string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.members[pubkey]
}

func (c *nip43Cache) addMember(pubkey string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.members[pubkey] = true
}

func (c *nip43Cache) removeMember(pubkey string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.members, pubkey)
}

// snapshot returns every current member's pubkey, sorted for a
// deterministic kind:13534 tag order (avoids a cosmetic no-op-looking
// diff on every republish if map iteration order changed but the actual
// membership didn't).
func (c *nip43Cache) snapshot() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]string, 0, len(c.members))
	for pk := range c.members {
		out = append(out, pk)
	}
	sort.Strings(out)
	return out
}

// signAndBroadcast constructs, signs (as the relay's own identity),
// stores, and broadcasts a brand-new relay-authored event — the first
// place in this codebase the relay mints its own events rather than
// only reacting to client-published ones. relay.AddEvent runs the exact
// same RejectEvent/StoreEvent/OnEventSaved pipeline a client-submitted
// event would (routing regular vs. replaceable/addressable kinds
// correctly on its own); relay.BroadcastEvent is the separate fan-out-
// to-live-subscribers step the normal WS handler would also do — the
// two together are the documented way to inject a "genuinely arrived"
// event from Go code (github.com/fiatjaf/khatru's own adding.go/
// broadcasting.go).
func signAndBroadcast(ctx context.Context, relay *khatru.Relay, secretKey string, kind int, tags nostr.Tags, content string) error {
	evt := nostr.Event{CreatedAt: nostr.Now(), Kind: kind, Tags: tags, Content: content}
	if err := evt.Sign(secretKey); err != nil {
		return err
	}
	skipBroadcast, err := relay.AddEvent(ctx, &evt)
	if err != nil {
		return err
	}
	if !skipBroadcast {
		relay.BroadcastEvent(&evt)
	}
	return nil
}

// membershipTags builds kind:13534's tag set from the current cache —
// per NIP-43, a "member" tag per pubkey. The "-" tag (NIP-70 protected-
// event marker) is what stops anyone but this relay's own key from ever
// publishing a convincing kind:8000/8001/13534/33534 — this relay's own
// existing NIP-70 enforcement (server/internal/khatrufork/handlers.go)
// already rejects a protected event whose author isn't the one
// authenticated over the connection, and nobody else holds this
// relay's private key.
func membershipTags(cache *nip43Cache) nostr.Tags {
	members := cache.snapshot()
	tags := make(nostr.Tags, 0, len(members)+1)
	tags = append(tags, nostr.Tag{"-"})
	for _, pk := range members {
		tags = append(tags, nostr.Tag{"member", pk})
	}
	return tags
}

func publishRoleDefinition(ctx context.Context, relay *khatru.Relay, secretKey string) error {
	tags := nostr.Tags{
		{"-"},
		{"d", "member"},
		{"label", "Member"},
		{"description", "Full read/write access — this relay is open, every join request is accepted automatically."},
	}
	return signAndBroadcast(ctx, relay, secretKey, kindNip43Roles, tags, "")
}

// newNip43EphemeralHook handles kind:28934 (join) / kind:28936 (leave) —
// both fall in NIP-01's ephemeral kind range (20000-29999), so they
// arrive via OnEphemeralEvent, never stored themselves, unlike the
// kind:8000/8001 confirmations they trigger. Deliberately synchronous,
// not dispatched into a goroutine the way the hot-path hooks elsewhere
// in this codebase are (health.go, push_notify.go) — join/leave
// requests are expected to be rare (nobody joins a relay's membership
// as often as they post a note), and the switch below no-ops
// immediately for every other ephemeral kind, so this doesn't add
// overhead to unrelated ephemeral traffic. Worth revisiting if this
// relay ever sees real join/leave volume.
func newNip43EphemeralHook(relay *khatru.Relay, cache *nip43Cache, secretKey string) func(ctx context.Context, evt *nostr.Event) {
	return func(ctx context.Context, evt *nostr.Event) {
		switch evt.Kind {
		case kindNip43JoinRequest:
			if cache.isMember(evt.PubKey) {
				return
			}
			cache.addMember(evt.PubKey)
			if err := signAndBroadcast(ctx, relay, secretKey, kindNip43MemberAdded, nostr.Tags{{"p", evt.PubKey}, {"-"}}, ""); err != nil {
				fmt.Println("nip43: could not publish member-added:", err)
				return
			}
			if err := signAndBroadcast(ctx, relay, secretKey, kindNip43Members, membershipTags(cache), ""); err != nil {
				fmt.Println("nip43: could not publish membership list:", err)
			}
		case kindNip43LeaveReq:
			if !cache.isMember(evt.PubKey) {
				return
			}
			cache.removeMember(evt.PubKey)
			if err := signAndBroadcast(ctx, relay, secretKey, kindNip43MemberLeft, nostr.Tags{{"p", evt.PubKey}, {"-"}}, ""); err != nil {
				fmt.Println("nip43: could not publish member-removed:", err)
				return
			}
			if err := signAndBroadcast(ctx, relay, secretKey, kindNip43Members, membershipTags(cache), ""); err != nil {
				fmt.Println("nip43: could not publish membership list:", err)
			}
		}
	}
}
