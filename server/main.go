package main

import (
	"fmt"
	"net/http"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/eventstore/bluge"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr/sdk"
)

func main() {
	relay := khatru.NewRelay()

	relay.Info.Name = "NOSTRAS Relay"
	relay.Info.Description = "Self-hosted relay/node for the NOSTRAS client."
	relay.Info.Software = "https://github.com/fiatjaf/khatru"
	relay.Info.Version = "0.0.0"
	relay.Info.AddSupportedNIP(50) // search — khatru doesn't auto-detect this one

	db := badger.BadgerBackend{Path: "./data"}
	if err := db.Init(); err != nil {
		panic(err)
	}

	// NIP-50 full-text search index (pure Go, no cgo — stores only IDs,
	// fetches actual events from db). See search.go.
	searchIndex := bluge.BlugeBackend{Path: "./search-index", RawEventStore: &db}
	if err := searchIndex.Init(); err != nil {
		panic(err)
	}

	relay.StoreEvent = append(relay.StoreEvent, db.SaveEvent, searchIndex.SaveEvent)
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

	fmt.Println("NOSTRAS relay running on :7777")
	http.ListenAndServe(":7777", relay)
}
