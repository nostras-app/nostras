package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	dgraphBadger "github.com/dgraph-io/badger/v4"
	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/eventstore/bluge"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip11"
	"github.com/nbd-wtf/go-nostr/sdk"
)

// maxFilterLimit bounds how many events a single REQ filter can ask for
// — applied twice, deliberately, at two different boundaries: once via
// BadgerBackend.MaxLimit (server/main.go's db := badger.BadgerBackend{}
// literal), which bounds the library's own fallback for a filter that
// omits `limit` entirely (otherwise defaults to maxLimit/4 = 250 with
// no cap set at all — the gap a live pprof profile caught, see the
// MaxLimit field's own comment); once via the OverwriteFilter hook
// below, which catches a filter that explicitly asks for more than
// this. See PQ-085/its 2026-09-09 follow-up in NOSTRAS-CSV.md for the
// production incident that prompted both.
const maxFilterLimit = 200

// indexLongerTag opts address-shaped ("kind:pubkey:d") tag values into
// badger's index instead of being silently dropped. Real bug found
// while building NIP-22 comments, not a NIP-22-specific fix: the
// vendored eventstore badger backend (v0.17.9) only indexes tag values
// up to 100 characters by default (badger/helpers.go's
// `len(tag[1]) > 100` check) unless BadgerBackend.IndexLongerTag is
// explicitly set — which this project never did, so the backend's own
// already-existing compact "kind:pubkey:d" address encoding
// (getTagIndexPrefix) was never actually reachable for any address
// whose d tag pushes the whole value past 100 chars. That's not an edge
// case here: it's the NORMAL case for this app's own kind:30023
// articles, whose d tag is a crypto.randomUUID() (36 chars) —
// "30023:" + a 64-char hex pubkey + ":" + a 36-char UUID = 107
// characters, always over the limit. Confirmed live: a real NIP-22
// kind:1111 comment's "A"/"a" tag pointing at one of this app's own
// real articles was completely unqueryable via a #A/#a filter before
// this fix — silently, no error anywhere. A general relay-indexing gap,
// not scoped to comments: anything else this project ever queries by a
// long addressable-event reference tag would have hit the same silent
// failure.
func indexLongerTag(_ *nostr.Event, _ string, tagValue string) bool {
	parts := strings.Split(tagValue, ":")
	if len(parts) != 3 {
		return false
	}
	pk, err := hex.DecodeString(parts[1])
	return err == nil && len(pk) == 32
}

// envOr returns the environment variable's value, or fallback if unset —
// used so the Fly deployment (which mounts a Volume at /data and sets these
// explicitly) and local dev (which gets these defaults, unchanged) share
// the same binary/code path.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	relay := khatru.NewRelay()

	// NOSTRAS_VERSION is the deploying commit's short git SHA, baked in as a
	// build-time Docker ARG (see Dockerfile) and passed by the CI workflow
	// (.github/workflows/deploy-relay.yml) — "dev" for a plain local
	// `go run .` with no ARG supplied. Public by design: NIP-11's version
	// field exists exactly for this, and every relay explorer already
	// knows to check it.
	relay.Info.Name = "NOSTRAS Relay"
	relay.Info.Description = "Self-hosted relay/node for the NOSTRAS client."
	// A real, spec-defined NIP-11 field (commonly a URL, npub, or mailto)
	// left unset until now. Populated with the client's own landing page
	// rather than an npub/email, matching what a relay explorer's "contact"
	// display most usefully resolves to for a project like this one.
	relay.Info.Contact = "https://nostras.app"
	relay.Info.Software = "https://github.com/fiatjaf/khatru"
	relay.Info.Version = envOr("NOSTRAS_VERSION", "dev")
	relay.Info.AddSupportedNIP(50) // search — khatru doesn't auto-detect this one
	relay.Info.AddSupportedNIP(29) // groups — see nip29.go
	relay.Info.AddSupportedNIP(62) // request to vanish — see vanish.go
	relay.Info.AddSupportedNIP(86) // relay management API — see adminapi.go

	badgerPath := envOr("NOSTRAS_BADGER_PATH", "./data")
	blugePath := envOr("NOSTRAS_BLUGE_PATH", "./search-index")
	port := envOr("NOSTRAS_PORT", "7777")

	// Real production incident (2026-08-07): badger.DefaultOptions (read
	// directly from dgraph-io/badger/v4's own source) is tuned for
	// multi-GB server deployments, not this machine's 512MB budget —
	// NumMemtables(5) * MemTableSize(64MB) = up to 320MB, plus a 256MB
	// BlockCacheSize, plus IndexCacheSize left at 0 (badger's docs: 0
	// means indices are loaded fully into memory with no bound, growing
	// permanently as the store grows, never evicted). That combination
	// alone exceeds this machine's entire RAM before Go's own runtime,
	// bluge's separate index, or a single live connection are accounted
	// for — confirmed as the real driver of two near-OOM incidents
	// within the same session, the second of which recurred with only
	// ~78 live connections (vs. 305 in the first), ruling out connection
	// count as this incident's cause and matching this project's own
	// prior observation that local badger boot times have been growing
	// as the store accumulates data from ongoing outbox aggregation.
	// Second correction, same day: a follow-up rebalance attempt (32MB
	// block cache -> 96MB, memtables 3*16MB -> 4*32MB, AND NumCompactors
	// dropped 4 -> 2) made things measurably worse, not better --
	// confirmed live: within minutes of a fresh boot, load average hit
	// 5.74 (5-min) on this single shared vCPU and connections started
	// failing outright (not just slow), before real user traffic could
	// plausibly explain it. Most likely mechanism: this machine has one
	// real core regardless of how many compactor goroutines badger runs,
	// so *halving* NumCompactors while simultaneously *increasing*
	// memtable size (more data queued for compaction at once) left less
	// effective throughput to clear the larger backlog, especially right
	// at boot when existing on-disk tables are being reopened. Reverted
	// NumCompactors to badger's default (4) and pulled the memtable/cache
	// sizes back to the first pass's values, which -- while not perfectly
	// tuned -- did not exhibit outright connection failures the way this
	// second attempt did. Worst case here is roughly 3*16=48MB memtables
	// + 32MB block cache + a bounded 32MB index cache, versus the
	// ~580MB+ default ceiling that caused the original incident.
	// Deliberately NOT continuing to hand-tune further knobs live against
	// production after two consecutive attempts each had real negative
	// side effects -- if this baseline still isn't sufficient, the right
	// next step is more machine memory, not a third guess at cache sizes.
	//
	// Third pass (2026-08-31), grounded in live evidence, not a guess: the
	// `web` machine's own CPU was found pegged at 90%+ user time on its
	// single vCPU, causing real connection timeouts (both the DVM's
	// internal reconnect loop and public wss:// clients). Traced via
	// badger's own periodic block-cache-metrics log line: a sustained
	// ~9,000 cache gets/sec with only a 0.28 hit ratio -- confirmed via
	// three consecutive 5-minute deltas (8,690/8,890/9,190 gets/sec), not
	// a one-off spike. Root cause: the store had grown to a real 1.7GB
	// (`du -sh /data/badger`) against a 32MB block cache -- ~53x
	// undersized -- so ~72% of lookups required an actual disk
	// read+decompress, real CPU work on a 1-core machine. That 32MB figure
	// was sized for the 512MB-machine era (see the comment above); the
	// machine has since grown to ~4GB total with ~2.7GB genuinely free at
	// the time of this change (`MemAvailable`), headroom that was never
	// revisited.
	//
	// This pass deliberately isolates the one variable actually implicated
	// in the second incident's regression: it grows ONLY the two read
	// caches (BlockCacheSize, IndexCacheSize), which sit on the read path
	// and cannot plausibly affect compaction throughput or backlog.
	// MemTableSize/NumMemtables are left completely untouched, and
	// NumCompactors is left at badger's own default (never overridden here
	// to begin with) -- the second incident's regression came from
	// *simultaneously* growing memtables (bigger compaction backlog) while
	// *halving* NumCompactors (less throughput to clear it), not from the
	// block-cache size on its own. BlockCacheSize is set to badger's own
	// documented default (256MB) rather than an invented number -- a
	// well-tested value, not a fresh guess. IndexCacheSize goes to 128MB
	// (smaller than the block cache since index entries are per-key
	// metadata, not full blocks) and stays explicitly bounded, never 0
	// (badger's docs: 0 means unbounded growth -- the root cause of the
	// very first near-OOM incident this file already documents). Worst
	// case footprint: 48MB memtables (unchanged) + 256MB block cache +
	// 128MB index cache = 432MB, comfortably inside the ~2.7GB currently
	// free, versus the previous ~112MB total.
	db := badger.BadgerBackend{
		Path: badgerPath,
		BadgerOptionsModifier: func(opts dgraphBadger.Options) dgraphBadger.Options {
			return opts.
				WithMemTableSize(16 << 20).
				WithNumMemtables(3).
				WithBlockCacheSize(256 << 20).
				WithIndexCacheSize(128 << 20)
		},
		IndexLongerTag: indexLongerTag,
		// Left unset, this defaults to 1000 (eventstore/badger's own
		// Init()) — and a filter with NO `limit` field at all (an
		// extremely common shape: most live kind/tag subscriptions, ours
		// and third-party clients alike, never set one) falls back to
		// maxLimit/4 = 250 results, which is *more* than the
		// maxFilterLimit OverwriteFilter clamp below allows for a filter
		// that explicitly asks for a large limit. Found via a live pprof
		// profile (2026-09-09, PQ-085 follow-up) still showing ~88% of
		// relay CPU in badger's tag-index point-lookup path even after
		// that clamp shipped — this is the gap it never covered. Setting
		// MaxLimit here fixes it at the actual library boundary, for
		// every code path, not just the explicit-large-limit case the
		// OverwriteFilter hook catches.
		MaxLimit: maxFilterLimit,
	}
	if err := db.Init(); err != nil {
		panic(err)
	}

	// NIP-50 full-text search index (pure Go, no cgo — stores only IDs,
	// fetches actual events from db). See search.go.
	searchIndex := bluge.BlugeBackend{Path: blugePath, RawEventStore: &db}
	if err := searchIndex.Init(); err != nil {
		panic(err)
	}

	// NIP-29 groups — see nip29.go. Boot-time scan populates the
	// permission cache from whatever's already stored, so a restart never
	// requires a group to be recreated; panics on failure to match
	// db.Init()/searchIndex.Init()'s existing posture just above.
	nip29Cache := newGroupCache()
	if err := nip29Cache.loadFromStore(context.Background(), &db); err != nil {
		panic(err)
	}
	relay.RejectEvent = append(relay.RejectEvent, newNip29RejectEventHook(nip29Cache))

	// Web Push subscriptions — see push.go/push_handlers.go/push_notify.go.
	// A plain JSON file, not a Nostr event: unlike everything else this
	// relay persists, a push subscription's endpoint/keys must stay
	// private, never broadcast. Degrades to a no-op if VAPID keys are
	// unset (same "gracefully skip the feature, don't refuse to start"
	// pattern as the DVM's payment gating).
	pushSubsPath := envOr("NOSTRAS_PUSH_SUBSCRIPTIONS_PATH", "./push-subscriptions.json")
	pushSubs, err := newPushStore(pushSubsPath)
	if err != nil {
		panic(err)
	}
	vapidPublicKey := os.Getenv("NOSTRAS_VAPID_PUBLIC_KEY")
	vapidPrivateKey := os.Getenv("NOSTRAS_VAPID_PRIVATE_KEY")
	vapidSubscriber := envOr("NOSTRAS_VAPID_SUBSCRIBER", "mailto:admin@nostras.app")
	if vapidPrivateKey == "" {
		fmt.Println("push notifications: OFF (NOSTRAS_VAPID_PRIVATE_KEY not set)")
	} else {
		fmt.Println("push notifications: ON")
	}
	relay.Router().HandleFunc("POST /push/subscribe", handlePushSubscribe(pushSubs))
	relay.Router().HandleFunc("POST /push/unsubscribe", handlePushUnsubscribe(pushSubs))

	// NIP-62 Request to Vanish — see vanish.go. A plain JSON file (same
	// pattern as pushSubs/analytics above), not a Nostr event: it's
	// relay-operational bookkeeping (who asked to be erased, up to when),
	// not content meant to be broadcast.
	vanishStorePath := envOr("NOSTRAS_VANISH_STORE_PATH", "./vanished-pubkeys.json")
	vanished, err := newVanishStore(vanishStorePath)
	if err != nil {
		panic(err)
	}
	relay.RejectEvent = append(relay.RejectEvent, newVanishRejectEventHook(vanished))

	// NIP-86 Relay Management API — see adminapi.go. rl.ManagementAPI was
	// declared and dispatched by the khatru fork but never actually
	// assigned anywhere in this file (found while building the NIP-62 work
	// above), so every real call silently returned "method X not
	// supported" for every method. NOSTRAS_ADMIN_PUBKEY is the operator's
	// own real pubkey, set as a Fly secret the same way
	// NOSTRAS_DASHBOARD_PASSWORD already is — unset means the whole API
	// stays inert (every call rejected as unauthorized), same
	// safe-by-default posture as the dashboard and DVM payment gating.
	nip86StorePath := envOr("NOSTRAS_NIP86_STORE_PATH", "./nip86-admin.json")
	nip86Store, err := newNip86Store(nip86StorePath)
	if err != nil {
		panic(err)
	}
	adminPubkey := os.Getenv("NOSTRAS_ADMIN_PUBKEY")
	if adminPubkey == "" {
		fmt.Println("NIP-86 relay management: OFF (NOSTRAS_ADMIN_PUBKEY not set)")
	} else {
		fmt.Println("NIP-86 relay management: ON")
	}
	applyNip86RelayInfoOverrides(relay, nip86Store)
	relay.ManagementAPI = buildNip86ManagementAPI(relay, &db, nip86Store, adminPubkey)
	relay.RejectEvent = append(relay.RejectEvent, newNip86RejectEventHook(nip86Store))
	relay.RejectConnection = append(relay.RejectConnection, newNip86RejectConnectionHook(nip86Store))
	relay.OnEventSaved = append(relay.OnEventSaved, newNip86ReportObserverHook(nip86Store))

	// NIP-13 Proof of Work — see pow.go. NOSTRAS_MIN_POW_DIFFICULTY unset
	// or <= 0 means the feature stays fully off: no RejectEvent hook
	// registered at all, and no `limitation` object in NIP-11 either —
	// same "off means don't even advertise the capability" posture as
	// NIP-43. This matters here specifically because every existing
	// publish path in this app (Composer, DVM results, DM gift wraps,
	// etc.) never mines PoW by default — turning this on is a real,
	// deliberate operator choice to start rejecting all of that unless
	// clients opt in, not a default this relay should silently adopt.
	if minPowDifficulty, err := strconv.Atoi(envOr("NOSTRAS_MIN_POW_DIFFICULTY", "0")); err == nil && minPowDifficulty > 0 {
		relay.RejectEvent = append(relay.RejectEvent, newMinPowRejectEventHook(minPowDifficulty))
		relay.Info.Limitation = &nip11.RelayLimitationDocument{MinPowDifficulty: minPowDifficulty}
		relay.Info.AddSupportedNIP(13)
		fmt.Printf("NIP-13 proof of work: ON (min difficulty %d)\n", minPowDifficulty)
	} else {
		fmt.Println("NIP-13 proof of work: OFF (NOSTRAS_MIN_POW_DIFFICULTY not set)")
	}

	// Connection analytics + dashboard — see analytics.go/dashboard.go/
	// dashboard.html. Counts unique relay connections per day/country (IP
	// used only transiently for the country lookup, never stored) so the
	// operator can see rough usage volume and geography for marketing
	// purposes. Dashboard is Basic-Auth gated behind
	// NOSTRAS_DASHBOARD_PASSWORD; unset means the dashboard route refuses
	// every request rather than serving unprotected.
	analyticsPath := envOr("NOSTRAS_ANALYTICS_PATH", "./analytics.json")
	analytics, err := newAnalyticsStore(analyticsPath)
	if err != nil {
		panic(err)
	}
	// Local MMDB country lookup (see analytics.go's own comment on why
	// this replaced a live ipapi.co call) — baked into the Docker image
	// at build time, not on the persistent /data volume, since it's
	// static reference data refreshed by rebuilding the image, not
	// something this process ever writes to.
	geoipPath := envOr("NOSTRAS_GEOIP_DB_PATH", "./geoip-country-lite.mmdb")
	geoip, err := openGeoIPLookup(geoipPath)
	if err != nil {
		panic(err)
	}
	if geoip.reader != nil {
		fmt.Println("GeoIP country lookup: ON (local database)")
	} else {
		fmt.Printf("GeoIP country lookup: OFF (%s not found — connection analytics will show \"unknown\" for every country)\n", geoipPath)
	}
	// Page-view analytics for the static public pages (landing, /why,
	// /node) — see pageviews.go. Same aggregate, no-PII shape as the
	// connection analytics above, answering a different question ("is
	// anyone actually visiting these pages") rather than "how many app
	// instances are connecting." Created here (not near the route
	// registrations below) so it's available to handleDashboardData,
	// which merges both into one response.
	pageViewsPath := envOr("NOSTRAS_PAGE_VIEWS_PATH", "./page-views.json")
	pageViews, err := newPageViewStore(pageViewsPath)
	if err != nil {
		panic(err)
	}

	// Real NOSTRAS client loads — see heartbeat.go for the full reasoning
	// (why this exists, why it deliberately carries no per-caller
	// identifier at all, not even a discarded one).
	heartbeatPath := envOr("NOSTRAS_HEARTBEAT_PATH", "./client-heartbeats.json")
	heartbeats, err := newHeartbeatStore(heartbeatPath)
	if err != nil {
		panic(err)
	}
	relay.OnConnect = append(relay.OnConnect, newAnalyticsConnectHook(analytics, geoip), newHealthConnectHook())
	relay.OnDisconnect = append(relay.OnDisconnect, newHealthDisconnectHook())
	relay.OnEventSaved = append(relay.OnEventSaved, newHealthEventSavedHook(), newNip29CacheUpdateHook(nip29Cache),
		newVanishEventSavedHook(relay, &db, vanished))

	// See maxLiveConnections in health.go for why this exists — runs before
	// the WebSocket upgrade, so a connection over the cap is refused
	// cleanly (429) instead of accepted and left to compete for memory an
	// existing client's request depends on.
	relay.RejectConnection = append(relay.RejectConnection, func(r *http.Request) bool {
		return tooManyConnections()
	})

	dashboardPassword := os.Getenv("NOSTRAS_DASHBOARD_PASSWORD")
	if dashboardPassword == "" {
		fmt.Println("dashboard: OFF (NOSTRAS_DASHBOARD_PASSWORD not set)")
	} else {
		fmt.Println("dashboard: ON")
	}
	relay.Router().HandleFunc("GET /dashboard", requireDashboardAuth(dashboardPassword, withSecurityHeaders(handleDashboard)))
	// Deliberately public, unlike every other /dashboard/* route — this
	// is the exact same aggregate, no-PII connection-count/country data
	// the public /stats page (see stats.go) fetches directly from a
	// visitor's own browser, which can't attach the dashboard password.
	// Real health/DVM-health/waitlist/page-view data stays gated below;
	// this endpoint was already the one genuinely safe-to-publish piece
	// of what /dashboard/data-adjacent routes expose.
	relay.Router().HandleFunc("GET /dashboard/data", handleDashboardData(analytics))
	relay.Router().HandleFunc("GET /dashboard/health", requireDashboardAuth(dashboardPassword, handleDashboardHealth))
	// Per-page landing traffic — briefly public alongside /dashboard/data
	// above (shipped 2026-08-16), moved behind the same auth gate as
	// waitlist signups the same day, per an explicit reconsideration:
	// unlike aggregate connection counts, per-page breakdowns were judged
	// worth keeping operator-only. See handleDashboardPageViews's own
	// comment in dashboard.go.
	relay.Router().HandleFunc("GET /dashboard/pageviews", requireDashboardAuth(dashboardPassword, handleDashboardPageViews(pageViews)))
	// Unauthenticated on purpose (see heartbeat.go) — a real client should
	// be able to call this the instant it loads, with no identity or
	// signer resolved yet.
	relay.Router().HandleFunc("POST /client-heartbeat", handleClientHeartbeat(heartbeats))
	relay.Router().HandleFunc("GET /dashboard/heartbeat", requireDashboardAuth(dashboardPassword, handleDashboardHeartbeat(heartbeats)))

	// Relay/identity enumeration — see enumerate.go/enumerate.html. Admin-
	// only, same password gate as the rest of /dashboard/*. Each scan is
	// triggered by a POST and polled via a GET status endpoint rather than
	// blocking a single long-lived request, since the (now multi-minute)
	// scan budget is far longer than most reverse-proxy idle-connection
	// timeouts are worth relying on. Both stores accumulate across runs
	// (merge, not replace) and persist to the /data volume — applying the
	// "don't leave a new store on the ephemeral filesystem" lesson from the
	// start this time (see fly.toml), not after a redeploy quietly wipes
	// out accumulated discovery data the way it did for four earlier
	// stores in this project's own history.
	enumerateRelaysPath := envOr("NOSTRAS_ENUMERATE_RELAYS_PATH", "./enumerated-relays.json")
	relayEnum, err := newRelayEnumerator(enumerateRelaysPath)
	if err != nil {
		panic(err)
	}
	enumerateIdentitiesPath := envOr("NOSTRAS_ENUMERATE_IDENTITIES_PATH", "./enumerated-identities.json")
	identityEnum, err := newIdentityEnumerator(enumerateIdentitiesPath)
	if err != nil {
		panic(err)
	}
	relay.Router().HandleFunc("GET /dashboard/enumerate", requireDashboardAuth(dashboardPassword, handleEnumeratePage))
	relay.Router().HandleFunc("POST /dashboard/enumerate/relays/start", requireDashboardAuth(dashboardPassword, handleEnumerateRelaysStart(relayEnum)))
	relay.Router().HandleFunc("GET /dashboard/enumerate/relays/status", requireDashboardAuth(dashboardPassword, handleEnumerateRelaysStatus(relayEnum)))
	relay.Router().HandleFunc("POST /dashboard/enumerate/identities/start", requireDashboardAuth(dashboardPassword, handleEnumerateIdentitiesStart(identityEnum, relayEnum)))
	relay.Router().HandleFunc("GET /dashboard/enumerate/identities/status", requireDashboardAuth(dashboardPassword, handleEnumerateIdentitiesStatus(identityEnum)))

	// NOSTRAS Node waitlist — see waitlist.go/waitlist_handlers.go/
	// node.html. A real signup (email + optional note), not a mock,
	// validating actual demand before any tiering/licensing/multi-tenant
	// work gets built (see nostras-node-productization-strategy.md).
	// Public write endpoint (no auth — an anonymous visitor submitting
	// interest, not a signed-in identity); the resulting list is only
	// readable through the same password-gated dashboard as everything
	// else operator-facing.
	waitlistPath := envOr("NOSTRAS_WAITLIST_PATH", "./node-waitlist.json")
	waitlist, err := newWaitlistStore(waitlistPath)
	if err != nil {
		panic(err)
	}
	relay.Router().HandleFunc("POST /node/waitlist", handleWaitlistJoin(waitlist))
	relay.Router().HandleFunc("GET /dashboard/waitlist", requireDashboardAuth(dashboardPassword, handleDashboardWaitlist(waitlist)))

	// Landing page — see landing.go/landing.html. "/{$}" (not just "/")
	// matches the exact root only, per Go 1.22+ ServeMux pattern syntax —
	// a bare "/" would act as a catch-all subtree match and start
	// swallowing any other unmatched path. khatru's own ServeHTTP already
	// routes WS upgrades and NIP-11 (Accept: application/nostr+json)
	// requests to the relay itself before anything reaches this router,
	// so a plain browser visit is the only thing that lands here.
	relay.Router().HandleFunc("GET /{$}", withSecurityHeaders(wrapPageView(pageViews, geoip, "home", handleLanding)))

	// "Why NOSTRAS" — see why.go/why.html. A normal (non-root) path, so
	// no "/{$}" subtlety here: Go's ServeMux only treats a bare "/" as a
	// catch-all subtree, an exact path like "/why" matches only itself.
	relay.Router().HandleFunc("GET /why", withSecurityHeaders(wrapPageView(pageViews, geoip, "why", handleWhy)))

	// NOSTRAS Node waitlist page — see node.go/node.html.
	relay.Router().HandleFunc("GET /node", withSecurityHeaders(wrapPageView(pageViews, geoip, "node", handleNode)))

	// "Own Your Money" — self-hosted Alby Hub onboarding guide, see
	// wallet.go/wallet.html.
	relay.Router().HandleFunc("GET /wallet", withSecurityHeaders(wrapPageView(pageViews, geoip, "wallet", handleWallet)))

	// NOSTRAS AI Tools — the DVM sold as its own turnkey, pay-per-job
	// product, deliberately decoupled from any relay/self-hosting
	// pitch. See tools.go/tools.html.
	relay.Router().HandleFunc("GET /tools", withSecurityHeaders(wrapPageView(pageViews, geoip, "tools", handleTools)))

	// Public live usage stats — see stats.go/stats.html. The public half
	// of the dashboard split: real connection/geography data, no
	// password, backed by the now-public GET /dashboard/data above.
	relay.Router().HandleFunc("GET /stats", withSecurityHeaders(handleStats))

	relay.StoreEvent = append(relay.StoreEvent, db.SaveEvent, newGroupChatSearchIndexHook(&searchIndex),
		newPushNotifyHook(pushSubs, vapidPublicKey, vapidPrivateKey, vapidSubscriber))
	relay.DeleteEvent = append(relay.DeleteEvent, db.DeleteEvent, searchIndex.DeleteEvent)
	relay.CountEvents = append(relay.CountEvents, db.CountEvents)
	// The badger backend also ships a real CountEventsHLL (NIP-45's
	// pubkey-approximate/HyperLogLog counting variant, used for e.g.
	// "how many people follow this pubkey") but it was never wired up —
	// the khatru fork's CountEventsHLL slice stayed empty, so any HLL-
	// shaped COUNT request silently returned 0 (a false "nobody", not an
	// error) instead of either a real count or an honest "unsupported."
	relay.CountEventsHLL = append(relay.CountEventsHLL, db.CountEventsHLL)

	// NIP-65 outbox aggregation: resolve each queried author's write relays
	// and fan out to them too, caching results back into db. See outbox.go.
	sys := sdk.NewSystem(
		sdk.WithStore(&db),
		sdk.WithRelayListRelays([]string{
			"wss://relay.damus.io",
			"wss://relay.primal.net",
			"wss://purplepag.es",
		}),
	)
	// Real production incident (2026-09-04, see NOSTRAS-CSV.md's
	// PQ-067/PQ-069): a live heap-profile investigation confirmed the
	// outbox aggregation above — a deliberate, undocumented-until-now
	// write-through cache with no eviction — is the dominant driver of
	// this relay's recurring "the store outgrew the machine" capacity
	// incidents, not this project's own real user base. outboxcache.go
	// tracks exactly which stored events arrived ONLY via this path
	// (never a real client's own direct publish) and ages them out after
	// NOSTRAS_OUTBOX_CACHE_RETENTION_DAYS (default 30) — bounding growth
	// instead of another reactive memory-tier bump.
	outboxCachePath := envOr("NOSTRAS_OUTBOX_CACHE_PATH", "./outbox-cache.json")
	outboxCache, err := newOutboxCacheStore(outboxCachePath)
	if err != nil {
		panic(err)
	}
	outboxCacheRetentionDays, err := strconv.Atoi(envOr("NOSTRAS_OUTBOX_CACHE_RETENTION_DAYS", "30"))
	if err != nil || outboxCacheRetentionDays <= 0 {
		outboxCacheRetentionDays = 30
	}
	aggregatedQuery := newAggregatedQuery(&db, sys, outboxCache)
	relay.QueryEvents = append(relay.QueryEvents, newSearchAwareQuery(&searchIndex, aggregatedQuery))

	// Real, live production incident (2026-09-08): a client-side feature
	// requesting `limit: 500` on a tag-filtered query (kind:3 events
	// tagging a given pubkey, to approximate a follower count) pushed this
	// relay's CPU to ~95-100% sustained. A live pprof capture showed 91% of
	// CPU inside BadgerBackend.query, dominated by per-event Get() calls
	// each needing an SSTable block seek + decompress — badger's tag index
	// only yields matching keys, so a large `limit` on a tag-heavy filter
	// means that many individual point-lookups, each one expensive. The
	// client-side feature was reverted, but the relay had no protection of
	// its own against this shape from any client (old cached bundles,
	// other NIP-90/NIP-50-aware clients, anything future) — this closes
	// that gap at the actual resource boundary instead of only at one now-
	// reverted call site, the same "guard the boundary, not every caller"
	// principle already applied to wsGuard.ts (client-side) and the CSP
	// header (mixed content) elsewhere in this project's history.
	// Silently clamps rather than rejecting outright (OverwriteFilter, not
	// RejectFilter) — degrades a query to "fewer results than asked for"
	// instead of an error, the same graceful-degrade posture as every
	// other resource guard in this file (outboxSem, broadcastSem,
	// maxLiveConnections). Catches the explicit-large-limit case;
	// BadgerBackend.MaxLimit (set on the `db` literal above) catches the
	// omitted-limit case this hook alone can't — see maxFilterLimit's own
	// doc comment.
	relay.OverwriteFilter = append(relay.OverwriteFilter, func(ctx context.Context, filter *nostr.Filter) {
		if filter.Limit > maxFilterLimit {
			filter.Limit = maxFilterLimit
		}
	})
	// Untracks an id the instant a real client directly publishes that
	// exact event — see outboxCacheStore's own doc comment for why this
	// is what makes eviction safe even in the "outbox-cached first,
	// genuinely published here later" edge case.
	relay.StoreEvent = append(relay.StoreEvent, newOutboxCacheUntrackHook(outboxCache))
	startOutboxCacheSweeper(relay, &db, outboxCache, outboxCacheRetentionDays)
	fmt.Printf("outbox cache: tracking %d cached events, %d-day retention\n", outboxCache.size(), outboxCacheRetentionDays)

	// NIP-43 Relay Access Metadata and Requests — see nip43.go. Does NOT
	// gate this relay (it stays exactly as open as before); it's real
	// protocol participation on top of that openness — a join request is
	// always accepted, since there's no admission decision to make on an
	// open relay. NOSTRAS_RELAY_PRIVATE_KEY (hex secret) gives the relay
	// its own stable signing identity, required to mint the kind:8000/
	// 8001/13534/33534 events this NIP defines — the first place this
	// codebase signs and publishes an event the relay itself authored,
	// rather than only reacting to client-published ones. Unset means the
	// feature stays fully inert (not advertised in NIP-11, no hooks
	// registered), same safe-by-default posture as NOSTRAS_ADMIN_PUBKEY.
	//
	// Placed here deliberately, after relay.StoreEvent/relay.QueryEvents
	// are both fully wired above — a real bug caught during verification,
	// not shipped: this block originally sat right after the NIP-86 setup
	// (much earlier in main()), which meant the one-time boot call to
	// publishRoleDefinition() ran relay.AddEvent against still-empty
	// StoreEvent/QueryEvents hook chains. AddEvent's manual replaceable-
	// event path iterates those chains and silently no-ops on an empty
	// slice — no error, "success" reported, but the event was never
	// actually persisted. Confirmed live: a real kind:33534 event
	// published this way came back from both `nak req` and `nak count`
	// as if it never existed, despite AddEvent reporting skipBroadcast=
	// false, err=nil.
	relayPrivateKey := os.Getenv("NOSTRAS_RELAY_PRIVATE_KEY")
	if relayPrivateKey == "" {
		fmt.Println("NIP-43 relay membership: OFF (NOSTRAS_RELAY_PRIVATE_KEY not set)")
	} else {
		relayPubkey, err := nostr.GetPublicKey(relayPrivateKey)
		if err != nil {
			panic(err)
		}
		nip43Cache := newNip43Cache()
		if err := nip43Cache.loadFromStore(context.Background(), &db, relayPubkey); err != nil {
			panic(err)
		}
		relay.Info.AddSupportedNIP(43)
		relay.OnEphemeralEvent = append(relay.OnEphemeralEvent, newNip43EphemeralHook(relay, nip43Cache, relayPrivateKey))
		if err := publishRoleDefinition(context.Background(), relay, relayPrivateKey); err != nil {
			fmt.Println("nip43: could not publish role definition:", err)
		}
		fmt.Println("NIP-43 relay membership: ON, relay pubkey", relayPubkey)

		// NIP-66 relay self-discovery — see nip66.go. Reuses the exact
		// same relay identity as NIP-43 above rather than a separate key
		// or activation flag; the self-probe dials the relay's own real
		// listener on localhost (this always runs on the same host as
		// the listener, so no dependency on external DNS/TLS availability
		// at probe time), while NOSTRAS_RELAY_PUBLIC_URL is the address
		// advertised *in* the discovery event's own d tag — what an
		// external client would actually use to reach this relay.
		// Defaults to the same localhost address for local dev; set to
		// wss://nostras.app in production (fly.toml).
		relay.Info.AddSupportedNIP(66)
		nip66DialURL := "ws://localhost:" + port
		nip66PublicURL := envOr("NOSTRAS_RELAY_PUBLIC_URL", nip66DialURL)
		startNip66SelfDiscoveryLoop(relay, relayPrivateKey, nip66DialURL, nip66PublicURL, 6*time.Hour)
		fmt.Println("NIP-66 relay self-discovery: ON, publishing every 6h, advertised as", nip66PublicURL)
	}

	pprofPort := envOr("NOSTRAS_PPROF_PORT", "6061")
	startPprofServer(pprofPort)
	fmt.Println("pprof diagnostics: private network only, :" + pprofPort + "/debug/pprof/")

	fmt.Println("NOSTRAS relay running on :" + port)
	http.ListenAndServe(":"+port, relay)
}
