package main

import (
	"context"
	"fmt"
	"time"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

// NIP-66: Relay Discovery and Liveness Monitoring. Real, deliberately
// scoped implementation: NOSTRAS's relay self-publishes a single
// kind:30166 "relay discovery event" describing itself — supported NIPs
// (read live from relay.Info.SupportedNIPs, so this can never drift out
// of sync as new NIPs get added elsewhere in this codebase), access
// requirements, network type, and honestly *measured* self-RTT (a real
// open/read/write round trip against the relay's own live listener, not
// fabricated numbers) — refreshed periodically to keep the timestamp and
// RTT current. Since kind:30166 is addressable (30000-39999 range,
// keyed by kind+pubkey+d-tag), each refresh replaces the prior one
// rather than accumulating history.
//
// Deliberately does NOT implement kind:10166 (Relay Monitor
// Announcement) or become a real "monitor" of the wider relay ecosystem
// — that would mean impartially probing many *other* relays, a
// materially bigger feature than this pass covers. Publishing a 10166
// without actually doing that work would misrepresent intent, since the
// spec frames it as a monitor's declared commitment to keep publishing
// discovery data about relays it watches. This is self-description
// only — the same category of feature as the NIP-89 handler
// announcement and the landing page: making NOSTRAS's own relay
// honestly discoverable to other NIP-66-aware tooling, not building a
// discovery service of NOSTRAS's own.
//
// Off by default: reuses NOSTRAS_RELAY_PRIVATE_KEY, the same stable
// signing identity already established for NIP-43 — not a new key, and
// not a new activation flag. Unset means this feature stays fully
// inert too (not advertised in NIP-11, no probe loop started), same
// safe-by-default posture as everything else gated behind that key.

const (
	kindNip66RelayDiscovery = 30166
	// Ephemeral (NIP-01's 20000-29999 range): a relay is never required
	// to store or rebroadcast these, only acknowledge them — used purely
	// to time a real write round-trip without leaving any junk event
	// behind in this relay's own store or feed. Not a kind any other NIP
	// assigns meaning to; this process never expects anyone else to see
	// or interpret it.
	kindNip66SelfProbePing = 20166
	selfProbeTimeout       = 15 * time.Second
)

// measureAndPublishNip66Discovery opens a real client connection to the
// relay's own live listener (not an in-process shortcut — this measures
// genuine accept/handshake/round-trip cost, even though it necessarily
// runs from the same host), times three real operations against it —
// open, read (a REQ through EOSE), write (a throwaway ephemeral ping) —
// then signs and publishes the actual kind:30166 discovery event
// carrying those three honestly-measured numbers.
func measureAndPublishNip66Discovery(ctx context.Context, secretKey, dialURL, publicURL string, supportedNIPs []any) error {
	ctx, cancel := context.WithTimeout(ctx, selfProbeTimeout)
	defer cancel()

	openStart := time.Now()
	rl, err := nostr.RelayConnect(ctx, dialURL)
	if err != nil {
		return fmt.Errorf("nip66 self-probe: could not open connection: %w", err)
	}
	defer rl.Close()
	rttOpen := time.Since(openStart)

	readStart := time.Now()
	sub, err := rl.Subscribe(ctx, nostr.Filters{{Kinds: []int{1}, Limit: 1}})
	if err != nil {
		return fmt.Errorf("nip66 self-probe: could not subscribe: %w", err)
	}
	select {
	case <-sub.EndOfStoredEvents:
	case <-ctx.Done():
		return fmt.Errorf("nip66 self-probe: read timed out: %w", ctx.Err())
	}
	rttRead := time.Since(readStart)
	sub.Unsub()

	pubkey, err := nostr.GetPublicKey(secretKey)
	if err != nil {
		return err
	}

	ping := nostr.Event{PubKey: pubkey, CreatedAt: nostr.Now(), Kind: kindNip66SelfProbePing, Tags: nostr.Tags{}, Content: ""}
	if err := ping.Sign(secretKey); err != nil {
		return err
	}
	writeStart := time.Now()
	if err := rl.Publish(ctx, ping); err != nil {
		return fmt.Errorf("nip66 self-probe: write timing publish failed: %w", err)
	}
	rttWrite := time.Since(writeStart)

	tags := nostr.Tags{
		{"d", publicURL},
		{"n", "clearnet"},
		{"rtt-open", fmt.Sprintf("%d", rttOpen.Milliseconds())},
		{"rtt-read", fmt.Sprintf("%d", rttRead.Milliseconds())},
		{"rtt-write", fmt.Sprintf("%d", rttWrite.Milliseconds())},
		// This relay requires neither NIP-42 auth nor payment to read or
		// write — it's deliberately open (see CLAUDE.md's key-decisions
		// section), and the "!" prefix is the spec's own convention for
		// an explicitly-false requirement.
		{"R", "!auth"},
		{"R", "!payment"},
	}
	for _, n := range supportedNIPs {
		if num, ok := n.(int); ok {
			tags = append(tags, nostr.Tag{"N", fmt.Sprintf("%d", num)})
		}
	}

	discovery := nostr.Event{PubKey: pubkey, CreatedAt: nostr.Now(), Kind: kindNip66RelayDiscovery, Tags: tags, Content: ""}
	if err := discovery.Sign(secretKey); err != nil {
		return err
	}
	if err := rl.Publish(ctx, discovery); err != nil {
		return fmt.Errorf("nip66 self-probe: could not publish discovery event: %w", err)
	}
	return nil
}

// startNip66SelfDiscoveryLoop publishes once immediately (so a fresh
// deploy is discoverable right away) and then keeps republishing on an
// interval, refreshing the timestamp and RTT numbers rather than letting
// them go stale for the lifetime of the process. Runs entirely in its
// own goroutine — this never touches the relay's own event-handling hot
// path, same "never block on a slow/optional side operation" lesson
// this codebase already learned the hard way from the push-notification
// lock-contention incident.
func startNip66SelfDiscoveryLoop(relay *khatru.Relay, secretKey, dialURL, publicURL string, interval time.Duration) {
	publish := func() {
		if err := measureAndPublishNip66Discovery(context.Background(), secretKey, dialURL, publicURL, relay.Info.SupportedNIPs); err != nil {
			fmt.Println("nip66: self-discovery publish failed:", err)
		}
	}
	go func() {
		publish()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			publish()
		}
	}()
}
