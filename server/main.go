package main

import (
	"fmt"
	"net/http"
	"os"

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

	relay.Info.Name = "NOSTRAS Relay"
	relay.Info.Description = "Self-hosted relay/node for the NOSTRAS client."
	relay.Info.Software = "https://github.com/fiatjaf/khatru"
	relay.Info.Version = "0.0.0"
	relay.Info.AddSupportedNIP(50) // search — khatru doesn't auto-detect this one

	badgerPath := envOr("NOSTRAS_BADGER_PATH", "./data")
	blugePath := envOr("NOSTRAS_BLUGE_PATH", "./search-index")
	port := envOr("NOSTRAS_PORT", "7777")

	db := badger.BadgerBackend{Path: badgerPath}
	if err := db.Init(); err != nil {
		panic(err)
	}

	// NIP-50 full-text search index (pure Go, no cgo — stores only IDs,
	// fetches actual events from db). See search.go.
	searchIndex := bluge.BlugeBackend{Path: blugePath, RawEventStore: &db}
	if err := searchIndex.Init(); err != nil {
		panic(err)
	}

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
	relay.OnEventSaved = append(relay.OnEventSaved, newHealthEventSavedHook())

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

	relay.StoreEvent = append(relay.StoreEvent, db.SaveEvent, searchIndex.SaveEvent,
		newPushNotifyHook(pushSubs, vapidPublicKey, vapidPrivateKey, vapidSubscriber))
	relay.DeleteEvent = append(relay.DeleteEvent, db.DeleteEvent, searchIndex.DeleteEvent)
	relay.CountEvents = append(relay.CountEvents, db.CountEvents)

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
