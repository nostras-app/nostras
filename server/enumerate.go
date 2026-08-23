package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

//go:embed enumerate.html
var enumerateHTML []byte

// Admin-only relay/identity enumeration — the same passive-discovery
// mechanism sites like nostrwat.ch use for relays (watch a handful of
// well-known relays for events that name other relays), extended one step
// further: given a relay, ask it for every kind:0 profile it has, which
// trivially enumerates every pubkey that relay has ever stored. Neither
// half is an exploit of anything — Nostr pubkeys are public identifiers by
// design (not secrets, unlike private keys), and most relays already
// answer an unauthenticated, unfiltered kind:0 REQ with everything they
// have. This just automates and aggregates what any single `nak req`
// command against one relay already reveals.
//
// Deliberately bounded on every axis this project has been burned by
// before (see outbox.go's own incident history): a hard wall-clock budget
// per scan, a semaphore capping concurrent outbound relay connections, and
// — new here, since these relay URLs come from untrusted third-party
// event content rather than this app's own hardcoded list — a real
// SSRF guard before ever dialing a URL an attacker could have crafted to
// point at internal infrastructure (Fly's own `.internal` private
// networking, a cloud metadata endpoint, this relay's own loopback admin
// surface). Results are kept in memory only, replaced on each new scan —
// this is a point-in-time snapshot tool, not an accumulating store, so it
// doesn't need a fourth JSON-on-/data-volume file to remember.

const (
	enumerateConcurrency              = 6
	enumerateScanBudget               = 30 * time.Second
	enumerateConnTimeout              = 8 * time.Second
	enumerateSampleCap                = 500
	enumerateMaxRelaysPerIdentityScan = 20
	enumerateDNSTimeout               = 3 * time.Second
)

// The same bootstrap set already used for NIP-65 outbox discovery in
// main.go's sdk.NewSystem call — duplicated here as a plain slice (sdk.System
// doesn't expose its configured relay list back out) since it's small,
// stable, and already hardcoded once in this same binary.
var enumerateBootstrapRelays = []string{
	"wss://relay.damus.io",
	"wss://relay.primal.net",
	"wss://purplepag.es",
}

// isSafeRelayURLForScan rejects anything that could turn this admin-
// triggered scan into a probe of internal infrastructure — the server-side
// equivalent of the private/loopback-address guard this project's client
// already applies to relay hints found in untrusted event content
// (relayFilter.ts, the DM recipient-relay-discovery fix, MentionLink.tsx).
// A malicious kind:10002/30166 event is exactly as untrusted here as an
// outbox-discovered relay hint is there — it's third-party content this
// app didn't choose. Checks the literal host first, then resolves
// hostname-form URLs and checks the resolved IPs too (a bare hostname
// check alone is weak against an attacker-controlled domain that simply
// resolves to an internal address).
func isSafeRelayURLForScan(ctx context.Context, raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "ws" && u.Scheme != "wss") || u.Hostname() == "" {
		return false
	}
	host := u.Hostname()
	if host == "localhost" || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".local") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return isPublicIP(ip)
	}

	resolveCtx, cancel := context.WithTimeout(ctx, enumerateDNSTimeout)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIPAddr(resolveCtx, host)
	if err != nil || len(addrs) == 0 {
		return false // fail closed: can't confirm it's safe, don't connect
	}
	for _, addr := range addrs {
		if !isPublicIP(addr.IP) {
			return false
		}
	}
	return true
}

// cgnatBlock is RFC 6598 shared address space (100.64.0.0/10) — real,
// found live while testing this exact function, not theoretical: a real
// relay discovered from a genuine NIP-65 event resolved to
// 100.115.247.122, which Go's own net.IP.IsPrivate() does NOT flag (it
// only covers the three RFC 1918 ranges). CGNAT space is exactly what
// Tailscale's own overlay network — a real, common way people self-host a
// personal relay — uses, so it's not "the public internet" despite not
// being IsPrivate() by Go's narrower definition.
var cgnatBlock = func() *net.IPNet {
	_, block, _ := net.ParseCIDR("100.64.0.0/10")
	return block
}()

func isPublicIP(ip net.IP) bool {
	return !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() &&
		!ip.IsLinkLocalMulticast() && !ip.IsUnspecified() && !cgnatBlock.Contains(ip)
}

// normalizeRelayURLForEnum does just enough canonicalization for dedup
// purposes (trailing slash, surrounding whitespace) — not a full
// normalization pass, since the goal here is "don't double-count the same
// relay," not byte-perfect URL canonicalization.
func normalizeRelayURLForEnum(raw string) string {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimSuffix(trimmed, "/")
	if trimmed == "" {
		return ""
	}
	u, err := url.Parse(trimmed)
	if err != nil || (u.Scheme != "ws" && u.Scheme != "wss") || u.Hostname() == "" {
		return ""
	}
	return trimmed
}

// --- relay enumeration -----------------------------------------------

type relayEnumResult struct {
	Running       bool     `json:"running"`
	StartedAt     int64    `json:"startedAt,omitempty"`
	FinishedAt    int64    `json:"finishedAt,omitempty"`
	Relays        []string `json:"relays"`
	EventsScanned int      `json:"eventsScanned"`
	Skipped       int      `json:"skippedUnsafe"`
	Error         string   `json:"error,omitempty"`
}

type relayEnumerator struct {
	mu     sync.Mutex
	result relayEnumResult
}

var relayEnum = &relayEnumerator{}

func (e *relayEnumerator) snapshot() relayEnumResult {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.result
}

func (e *relayEnumerator) start() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.result.Running {
		return false
	}
	e.result = relayEnumResult{Running: true, StartedAt: time.Now().Unix()}
	return true
}

func (e *relayEnumerator) finish(relays []string, events, skipped int, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.result.Running = false
	e.result.FinishedAt = time.Now().Unix()
	e.result.Relays = relays
	e.result.EventsScanned = events
	e.result.Skipped = skipped
	if err != nil {
		e.result.Error = err.Error()
	}
}

// runRelayEnumeration mirrors how nostrwat.ch and similar tools actually
// discover relays: not by scanning IP ranges, but by watching a handful of
// well-known bootstrap relays for the two event kinds that name a relay
// URL as part of their own content — NIP-65 relay lists (kind:10002, an
// "r" tag per relay) and NIP-66 relay discovery events (kind:30166, whose
// own "d" tag IS the relay's URL — see nip66.go, which publishes NOSTRAS's
// own record this exact way). A single bounded-time subscription against
// the bootstrap set is enough; this deliberately does NOT recursively
// crawl newly-discovered relays for more relays, which would have no
// natural stopping point and risks the same kind of connection storm
// outbox.go's own incident history already taught this project to avoid.
func runRelayEnumeration(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, enumerateScanBudget)
	defer cancel()

	seen := make(map[string]bool)
	eventsScanned := 0
	skipped := 0
	var mu sync.Mutex

	var wg sync.WaitGroup
	sem := make(chan struct{}, enumerateConcurrency)

	for _, bootstrapURL := range enumerateBootstrapRelays {
		wg.Add(1)
		sem <- struct{}{}
		go func(bootstrapURL string) {
			defer wg.Done()
			defer func() { <-sem }()

			connCtx, connCancel := context.WithTimeout(ctx, enumerateConnTimeout)
			defer connCancel()
			rl, err := nostr.RelayConnect(connCtx, bootstrapURL)
			if err != nil {
				return
			}
			defer rl.Close()

			sub, err := rl.Subscribe(ctx, nostr.Filters{{Kinds: []int{10002, 30166}, Limit: 500}})
			if err != nil {
				return
			}
			defer sub.Unsub()

			for evt := range sub.Events {
				mu.Lock()
				eventsScanned++
				mu.Unlock()

				for _, tag := range evt.Tags {
					if len(tag) < 2 {
						continue
					}
					var candidate string
					switch {
					case evt.Kind == 10002 && tag[0] == "r":
						candidate = tag[1]
					case evt.Kind == 30166 && tag[0] == "d":
						candidate = tag[1]
					default:
						continue
					}
					normalized := normalizeRelayURLForEnum(candidate)
					if normalized == "" {
						continue
					}
					mu.Lock()
					alreadySeen := seen[normalized]
					mu.Unlock()
					if alreadySeen {
						continue
					}
					if !isSafeRelayURLForScan(ctx, normalized) {
						mu.Lock()
						skipped++
						mu.Unlock()
						continue
					}
					mu.Lock()
					seen[normalized] = true
					mu.Unlock()
				}
			}
		}(bootstrapURL)
	}

	wg.Wait()

	relays := make([]string, 0, len(seen))
	for r := range seen {
		relays = append(relays, r)
	}
	sort.Strings(relays)

	relayEnum.finish(relays, eventsScanned, skipped, nil)
}

// --- identity enumeration ----------------------------------------------

type identityEnumResult struct {
	Running    bool     `json:"running"`
	StartedAt  int64    `json:"startedAt,omitempty"`
	FinishedAt int64    `json:"finishedAt,omitempty"`
	RelaysUsed []string `json:"relaysUsed"`
	Total      int      `json:"total"`
	Sample     []string `json:"sample"`
	SampleCap  int      `json:"sampleCap"`
	Error      string   `json:"error,omitempty"`
}

type identityEnumerator struct {
	mu     sync.Mutex
	result identityEnumResult
}

var identityEnum = &identityEnumerator{}

func (e *identityEnumerator) snapshot() identityEnumResult {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.result
}

func (e *identityEnumerator) start(relays []string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.result.Running {
		return false
	}
	e.result = identityEnumResult{Running: true, StartedAt: time.Now().Unix(), RelaysUsed: relays}
	return true
}

func (e *identityEnumerator) finish(total int, sample []string, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.result.Running = false
	e.result.FinishedAt = time.Now().Unix()
	e.result.Total = total
	e.result.Sample = sample
	e.result.SampleCap = enumerateSampleCap
	if err != nil {
		e.result.Error = err.Error()
	}
}

// runIdentityEnumeration asks each given relay for every kind:0 profile it
// has, paginating backward via `until` until a relay stops returning new
// events, runs out of the shared scan budget, or makes no forward progress
// (guards against a relay that keeps re-sending the same page). This is
// deliberately a bounded sample within enumerateScanBudget, not an
// exhaustive crawl — an exhaustive crawl of even one popular relay's full
// history has no natural stopping point and would risk exactly the
// resource pattern this project's own outbox-aggregation incident already
// showed is dangerous at this machine's scale. The Total count still
// reflects every distinct pubkey actually seen (cheap to track — a set of
// hex strings costs a few MB even at six figures), only the Sample
// rendered back to the UI is capped.
func runIdentityEnumeration(ctx context.Context, relays []string) {
	ctx, cancel := context.WithTimeout(ctx, enumerateScanBudget)
	defer cancel()

	seen := make(map[string]bool)
	var mu sync.Mutex

	var wg sync.WaitGroup
	sem := make(chan struct{}, enumerateConcurrency)

	for _, relayURL := range relays {
		if !isSafeRelayURLForScan(ctx, relayURL) {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(relayURL string) {
			defer wg.Done()
			defer func() { <-sem }()

			connCtx, connCancel := context.WithTimeout(ctx, enumerateConnTimeout)
			defer connCancel()
			rl, err := nostr.RelayConnect(connCtx, relayURL)
			if err != nil {
				return
			}
			defer rl.Close()

			until := nostr.Now()
			for {
				select {
				case <-ctx.Done():
					return
				default:
				}

				pageCtx, pageCancel := context.WithTimeout(ctx, enumerateConnTimeout)
				sub, err := rl.Subscribe(pageCtx, nostr.Filters{{Kinds: []int{0}, Until: &until, Limit: 200}})
				if err != nil {
					pageCancel()
					return
				}

				count := 0
				oldest := until
				for evt := range sub.Events {
					count++
					mu.Lock()
					seen[evt.PubKey] = true
					mu.Unlock()
					if evt.CreatedAt < oldest {
						oldest = evt.CreatedAt
					}
				}
				pageCancel()

				if count == 0 || oldest >= until {
					return // relay exhausted, or this page made no progress
				}
				until = oldest
			}
		}(relayURL)
	}

	wg.Wait()

	total := len(seen)
	sample := make([]string, 0, enumerateSampleCap)
	for pk := range seen {
		if len(sample) >= enumerateSampleCap {
			break
		}
		sample = append(sample, pk)
	}
	sort.Strings(sample)

	identityEnum.finish(total, sample, nil)
}

// --- HTTP handlers -------------------------------------------------------

func handleEnumeratePage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(enumerateHTML)
}

func handleEnumerateRelaysStart(w http.ResponseWriter, r *http.Request) {
	if !relayEnum.start() {
		http.Error(w, "a relay scan is already running", http.StatusConflict)
		return
	}
	go runRelayEnumeration(context.Background())
	w.WriteHeader(http.StatusAccepted)
}

func handleEnumerateRelaysStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(relayEnum.snapshot())
}

func handleEnumerateIdentitiesStart(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Relays []string `json:"relays"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body) // empty/absent body is fine — falls through to defaults below

	relays := body.Relays
	if len(relays) == 0 {
		relays = relayEnum.snapshot().Relays
	}
	if len(relays) == 0 {
		relays = enumerateBootstrapRelays
	}
	if len(relays) > enumerateMaxRelaysPerIdentityScan {
		relays = relays[:enumerateMaxRelaysPerIdentityScan]
	}

	if !identityEnum.start(relays) {
		http.Error(w, "an identity scan is already running", http.StatusConflict)
		return
	}
	go runIdentityEnumeration(context.Background(), relays)
	w.WriteHeader(http.StatusAccepted)
}

func handleEnumerateIdentitiesStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(identityEnum.snapshot())
}
