package main

import (
	"context"
	"fmt"
	"net/http"
	"os"

	dgraphBadger "github.com/dgraph-io/badger/v4"
	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/eventstore/bluge"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr/sdk"
)

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
	relay.Info.Software = "https://github.com/fiatjaf/khatru"
	relay.Info.Version = envOr("NOSTRAS_VERSION", "dev")
	relay.Info.AddSupportedNIP(50) // search — khatru doesn't auto-detect this one
	relay.Info.AddSupportedNIP(29) // groups — see nip29.go

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
	db := badger.BadgerBackend{
		Path: badgerPath,
		BadgerOptionsModifier: func(opts dgraphBadger.Options) dgraphBadger.Options {
			return opts.
				WithMemTableSize(16 << 20).
				WithNumMemtables(3).
				WithBlockCacheSize(32 << 20).
				WithIndexCacheSize(32 << 20)
		},
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
	relay.OnConnect = append(relay.OnConnect, newAnalyticsConnectHook(analytics), newHealthConnectHook())
	relay.OnDisconnect = append(relay.OnDisconnect, newHealthDisconnectHook())
	relay.OnEventSaved = append(relay.OnEventSaved, newHealthEventSavedHook(), newNip29CacheUpdateHook(nip29Cache))

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
	relay.Router().HandleFunc("GET /dashboard", requireDashboardAuth(dashboardPassword, handleDashboard))
	relay.Router().HandleFunc("GET /dashboard/data", requireDashboardAuth(dashboardPassword, handleDashboardData(analytics)))
	relay.Router().HandleFunc("GET /dashboard/health", requireDashboardAuth(dashboardPassword, handleDashboardHealth))

	// Landing page — see landing.go/landing.html. "/{$}" (not just "/")
	// matches the exact root only, per Go 1.22+ ServeMux pattern syntax —
	// a bare "/" would act as a catch-all subtree match and start
	// swallowing any other unmatched path. khatru's own ServeHTTP already
	// routes WS upgrades and NIP-11 (Accept: application/nostr+json)
	// requests to the relay itself before anything reaches this router,
	// so a plain browser visit is the only thing that lands here.
	relay.Router().HandleFunc("GET /{$}", handleLanding)

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
	aggregatedQuery := newAggregatedQuery(&db, sys)
	relay.QueryEvents = append(relay.QueryEvents, newSearchAwareQuery(&searchIndex, aggregatedQuery))

	fmt.Println("NOSTRAS relay running on :" + port)
	http.ListenAndServe(":"+port, relay)
}
