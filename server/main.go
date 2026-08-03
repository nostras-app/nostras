package main

import (
	"fmt"
	"net/http"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/khatru"
)

func main() {
	relay := khatru.NewRelay()

	relay.Info.Name = "NOSTRAS Relay"
	relay.Info.Description = "Self-hosted relay/node for the NOSTRAS client."
	relay.Info.Software = "https://github.com/fiatjaf/khatru"
	relay.Info.Version = "0.0.0"

	db := badger.BadgerBackend{Path: "./data"}
	if err := db.Init(); err != nil {
		panic(err)
	}

	relay.StoreEvent = append(relay.StoreEvent, db.SaveEvent)
	relay.QueryEvents = append(relay.QueryEvents, db.QueryEvents)
	relay.DeleteEvent = append(relay.DeleteEvent, db.DeleteEvent)
	relay.CountEvents = append(relay.CountEvents, db.CountEvents)

	fmt.Println("NOSTRAS relay running on :7777")
	http.ListenAndServe(":7777", relay)
}
