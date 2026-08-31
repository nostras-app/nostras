package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

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
// Real gap found live during first use (2026-08-23): a first version did a
// single fresh, bounded, throw-away-on-next-click scan — 224 relays and
// 1828 identities against nostrwat.ch's 1600+ relays and reality's
// 200K+-follower accounts. Root-caused directly, not guessed: relay
// discovery did one Limit:500 REQ per bootstrap relay with no pagination
// at all, so a wider time budget alone did nothing once that cap was hit;
// identity enumeration paged backward from "now" across only 20 relays, so
// it was sampling the most-recently-updated profiles in the last half
// minute, nothing like a representative slice. The real, structural fix
// nostrwat.ch itself relies on isn't a bigger single scan, it's a
// continuously-accumulating index: both enumerators below are now backed
// by a persisted stringSetStore that MERGES each run's results into an
// ever-growing set rather than replacing it, relay discovery is now
// paginated the same way identity enumeration always was, and identity
// scans use every relay this project has ever discovered (not a small
// fixed slice) — so repeated runs genuinely converge toward real coverage
// over time instead of resetting to zero on every click.
//
// Bounded on every axis this project has been burned by before (see
// outbox.go's own incident history): a hard wall-clock budget per scan, a
// semaphore capping concurrent outbound relay connections, a per-relay
// page cap so one dense relay can't monopolize a scan's whole time slot,
// and — since these relay URLs come from untrusted third-party event
// content rather than this app's own hardcoded list — a real SSRF guard
// before ever dialing a URL an attacker could have crafted to point at
// internal infrastructure (Fly's own `.internal` private networking, a
// cloud metadata endpoint, this relay's own loopback admin surface).

const (
	enumerateConcurrency        = 12
	enumerateRelayScanBudget    = 3 * time.Minute
	enumerateIdentityScanBudget = 5 * time.Minute
	enumerateConnTimeout        = 8 * time.Second
	enumerateDNSTimeout         = 3 * time.Second
	enumerateMaxPagesPerRelay   = 15 // safety valve: one dense relay can't hog its whole scan slot
	enumerateSampleCap          = 500
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

// --- persisted, accumulating string set ---------------------------------

// stringSetStore is a small persisted, thread-safe set of strings, backed
// by a JSON file — the same mutex-guarded-JSON-file shape already
// established by analyticsStore/pushStore/waitlistStore/vanishStore, just
// generic enough to share between the relay-URL and pubkey accumulators
// below since both are structurally identical (a growing set of strings,
// merged across scans). Persisted on the /data volume from the start
// (see fly.toml) rather than left on the ephemeral-filesystem default —
// this project has hit that exact "forgot to put a new store on the
// volume" bug five separate times already (analytics, push subscriptions,
// waitlist, vanish tombstones, NIP-86 admin data); applying the lesson
// proactively here instead of rediscovering it a sixth time.
type stringSetStore struct {
	path string
	mu   sync.Mutex
	set  map[string]bool
}

func newStringSetStore(path string) (*stringSetStore, error) {
	s := &stringSetStore{path: path, set: make(map[string]bool)}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, err
	}
	var items []string
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, err
	}
	for _, item := range items {
		s.set[item] = true
	}
	return s, nil
}

// addMany merges the given items into the accumulated set and persists the
// result, returning how many were genuinely new (not already known) — the
// UI surfaces this as "new this run" so it's visible whether a scan is
// still finding fresh ground or has converged on what these relays have.
func (s *stringSetStore) addMany(items []string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	newCount := 0
	for _, item := range items {
		if !s.set[item] {
			s.set[item] = true
			newCount++
		}
	}
	if newCount > 0 {
		s.saveLocked()
	}
	return newCount
}

func (s *stringSetStore) all() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.set))
	for item := range s.set {
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}

func (s *stringSetStore) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.set)
}

// saveLocked must be called with s.mu already held.
func (s *stringSetStore) saveLocked() {
	items := make([]string, 0, len(s.set))
	for item := range s.set {
		items = append(items, item)
	}
	sort.Strings(items)
	data, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(s.path, data, 0644)
}

// --- relay enumeration ---------------------------------------------------

type relayEnumResult struct {
	Running          bool     `json:"running"`
	StartedAt        int64    `json:"startedAt,omitempty"`
	FinishedAt       int64    `json:"finishedAt,omitempty"`
	Relays           []string `json:"relays"` // full accumulated set, all runs
	LastRunEvents    int      `json:"lastRunEvents"`
	LastRunSkipped   int      `json:"lastRunSkipped"`
	LastRunNewRelays int      `json:"lastRunNewRelays"`
	Error            string   `json:"error,omitempty"`
}

type relayEnumerator struct {
	store *stringSetStore

	mu         sync.Mutex
	running    bool
	startedAt  int64
	finishedAt int64
	lastEvents int
	lastSkip   int
	lastNew    int
	err        string
}

func newRelayEnumerator(path string) (*relayEnumerator, error) {
	store, err := newStringSetStore(path)
	if err != nil {
		return nil, err
	}
	return &relayEnumerator{store: store}, nil
}

func (e *relayEnumerator) snapshot() relayEnumResult {
	e.mu.Lock()
	defer e.mu.Unlock()
	return relayEnumResult{
		Running:          e.running,
		StartedAt:        e.startedAt,
		FinishedAt:       e.finishedAt,
		Relays:           e.store.all(),
		LastRunEvents:    e.lastEvents,
		LastRunSkipped:   e.lastSkip,
		LastRunNewRelays: e.lastNew,
		Error:            e.err,
	}
}

func (e *relayEnumerator) start() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.running {
		return false
	}
	e.running = true
	e.startedAt = time.Now().Unix()
	e.finishedAt = 0
	e.err = ""
	return true
}

func (e *relayEnumerator) finish(events, skipped, newRelays int, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.running = false
	e.finishedAt = time.Now().Unix()
	e.lastEvents = events
	e.lastSkip = skipped
	e.lastNew = newRelays
	if err != nil {
		e.err = err.Error()
	}
}

// runRelayEnumeration mirrors how nostrwat.ch and similar tools actually
// discover relays: not by scanning IP ranges, but by watching a handful of
// well-known bootstrap relays for the two event kinds that name a relay
// URL as part of their own content — NIP-65 relay lists (kind:10002, an
// "r" tag per relay) and NIP-66 relay discovery events (kind:30166, whose
// own "d" tag IS the relay's URL — see nip66.go, which publishes NOSTRAS's
// own record this exact way). Paginated backward via `until` per bootstrap
// relay (a real fix, not present in the first version — a single Limit:500
// REQ meant a wider time budget did nothing once that cap was hit), capped
// per relay at enumerateMaxPagesPerRelay so one very active relay can't
// consume a whole scan's time budget by itself. Deliberately does NOT
// recursively crawl newly-discovered relays for more relays, which would
// have no natural stopping point and risks the same kind of connection
// storm outbox.go's own incident history already taught this project to
// avoid. Results are merged into the persisted store, not replaced — see
// stringSetStore's own comment for why.
func runRelayEnumeration(ctx context.Context, e *relayEnumerator) {
	ctx, cancel := context.WithTimeout(ctx, enumerateRelayScanBudget)
	defer cancel()

	found := make(map[string]bool)
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
			rl, err := nostr.RelayConnect(connCtx, bootstrapURL)
			connCancel()
			if err != nil {
				return
			}
			defer rl.Close()

			until := nostr.Now()
			for page := 0; page < enumerateMaxPagesPerRelay; page++ {
				select {
				case <-ctx.Done():
					return
				default:
				}

				pageCtx, pageCancel := context.WithTimeout(ctx, enumerateConnTimeout)
				sub, err := rl.Subscribe(pageCtx, nostr.Filters{{Kinds: []int{10002, 30166}, Until: &until, Limit: 200}})
				if err != nil {
					pageCancel()
					return
				}

				count := 0
				oldest := until
				for evt := range sub.Events {
					count++
					mu.Lock()
					eventsScanned++
					mu.Unlock()
					if evt.CreatedAt < oldest {
						oldest = evt.CreatedAt
					}

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
						if !isSafeRelayURLForScan(ctx, normalized) {
							mu.Lock()
							skipped++
							mu.Unlock()
							continue
						}
						mu.Lock()
						found[normalized] = true
						mu.Unlock()
					}
				}
				pageCancel()

				if count == 0 || oldest >= until {
					return // relay exhausted, or this page made no progress
				}
				until = oldest
			}
		}(bootstrapURL)
	}

	wg.Wait()

	newRelays := make([]string, 0, len(found))
	for r := range found {
		newRelays = append(newRelays, r)
	}
	newCount := e.store.addMany(newRelays)

	e.finish(eventsScanned, skipped, newCount, nil)
}

// --- identity enumeration -------------------------------------------------

type identityEnumResult struct {
	Running    bool     `json:"running"`
	StartedAt  int64    `json:"startedAt,omitempty"`
	FinishedAt int64    `json:"finishedAt,omitempty"`
	RelaysUsed []string `json:"relaysUsed"`
	Total      int      `json:"total"` // full accumulated distinct-pubkey count, all runs
	LastRunNew int      `json:"lastRunNew"`
	Sample     []string `json:"sample"`
	SampleCap  int      `json:"sampleCap"`
	Error      string   `json:"error,omitempty"`
}

type identityEnumerator struct {
	store *stringSetStore

	mu         sync.Mutex
	running    bool
	startedAt  int64
	finishedAt int64
	relaysUsed []string
	lastNew    int
	err        string
}

func newIdentityEnumerator(path string) (*identityEnumerator, error) {
	store, err := newStringSetStore(path)
	if err != nil {
		return nil, err
	}
	return &identityEnumerator{store: store}, nil
}

func (e *identityEnumerator) snapshot() identityEnumResult {
	e.mu.Lock()
	defer e.mu.Unlock()

	all := e.store.all()
	sample := all
	if len(sample) > enumerateSampleCap {
		sample = sample[:enumerateSampleCap]
	}

	return identityEnumResult{
		Running:    e.running,
		StartedAt:  e.startedAt,
		FinishedAt: e.finishedAt,
		RelaysUsed: e.relaysUsed,
		Total:      len(all),
		LastRunNew: e.lastNew,
		Sample:     sample,
		SampleCap:  enumerateSampleCap,
		Error:      e.err,
	}
}

func (e *identityEnumerator) start(relays []string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.running {
		return false
	}
	e.running = true
	e.startedAt = time.Now().Unix()
	e.finishedAt = 0
	e.relaysUsed = relays
	e.err = ""
	return true
}

func (e *identityEnumerator) finish(newCount int, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.running = false
	e.finishedAt = time.Now().Unix()
	e.lastNew = newCount
	if err != nil {
		e.err = err.Error()
	}
}

// runIdentityEnumeration asks each given relay for every kind:0 profile it
// has, paginating backward via `until` until a relay stops returning new
// events, runs out of the shared scan budget, hits enumerateMaxPagesPerRelay,
// or makes no forward progress (guards against a relay that keeps
// re-sending the same page). Given `relays` now, by default, means "every
// relay this project has ever discovered" rather than a small fixed slice
// (see the caller in handleEnumerateIdentitiesStart), the semaphore is what
// actually bounds resource use here — however many relay URLs are in the
// list, at most enumerateConcurrency connections are ever open at once, so
// a longer list just means more waves, not more simultaneous load. A scan
// that runs out of budget partway through the list simply leaves the rest
// for next time — combined with the persisted, merging store, coverage
// genuinely grows across repeated runs instead of resetting to a shallow
// sample every time.
func runIdentityEnumeration(ctx context.Context, e *identityEnumerator, relays []string) {
	ctx, cancel := context.WithTimeout(ctx, enumerateIdentityScanBudget)
	defer cancel()

	found := make(map[string]bool)
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
			rl, err := nostr.RelayConnect(connCtx, relayURL)
			connCancel()
			if err != nil {
				return
			}
			defer rl.Close()

			until := nostr.Now()
			for page := 0; page < enumerateMaxPagesPerRelay; page++ {
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
					found[evt.PubKey] = true
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

	newPubkeys := make([]string, 0, len(found))
	for pk := range found {
		newPubkeys = append(newPubkeys, pk)
	}
	newCount := e.store.addMany(newPubkeys)

	e.finish(newCount, nil)
}

// --- HTTP handlers -------------------------------------------------------

func handleEnumeratePage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(enumerateHTML)
}

func handleEnumerateRelaysStart(e *relayEnumerator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !e.start() {
			http.Error(w, "a relay scan is already running", http.StatusConflict)
			return
		}
		go runRelayEnumeration(context.Background(), e)
		w.WriteHeader(http.StatusAccepted)
	}
}

func handleEnumerateRelaysStatus(e *relayEnumerator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(e.snapshot())
	}
}

// maxEnumerateIdentitiesBodyBytes bounds the raw request body before JSON
// decoding — this route is already dashboard-password-gated (lower risk
// than the fully public/lightly-gated endpoints), but a size cap costs
// nothing and closes the same class of gap found during a security review
// (2026-09-01). 64KB comfortably covers even a genuinely large explicit
// relay-list override.
const maxEnumerateIdentitiesBodyBytes = 64 << 10

// handleEnumerateIdentitiesStart defaults to scanning EVERY relay this
// project has ever discovered (relayEnum's full accumulated set), not a
// small fixed slice — the real fix for the original "1828 identities
// against a 200K-follower reality" gap, which traced back to only ever
// asking 20 relays. An explicit `relays` list in the POST body still
// overrides this, for a future narrower/targeted scan.
func handleEnumerateIdentitiesStart(identityE *identityEnumerator, relayE *relayEnumerator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxEnumerateIdentitiesBodyBytes)
		var body struct {
			Relays []string `json:"relays"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body) // empty/absent body is fine — falls through to defaults below

		relays := body.Relays
		if len(relays) == 0 {
			relays = relayE.store.all()
		}
		if len(relays) == 0 {
			relays = enumerateBootstrapRelays
		}

		if !identityE.start(relays) {
			http.Error(w, "an identity scan is already running", http.StatusConflict)
			return
		}
		go runIdentityEnumeration(context.Background(), identityE, relays)
		w.WriteHeader(http.StatusAccepted)
	}
}

func handleEnumerateIdentitiesStatus(e *identityEnumerator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(e.snapshot())
	}
}

//go:embed enumerate.html
var enumerateHTML []byte
