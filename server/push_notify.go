package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/nbd-wtf/go-nostr"
)

// Kinds worth a push notification, matching NotificationsView's in-app
// list plus DMs. Payloads are deliberately generic, never the actual note/
// DM content: for kind:1059 the server can't decrypt it anyway (that's the
// point of a gift wrap), and keeping public-note payloads generic too is a
// reasonable default for what travels through a third-party push service.
var pushNotificationMeta = map[int]struct{ title, body string }{
	1:    {"New mention", "Someone mentioned or replied to your note"},
	6:    {"New repost", "Someone reposted your note"},
	7:    {"New like", "Someone liked your note"},
	9735: {"You got zapped!", "Someone sent you a zap"},
	1059: {"New message", "You received a new encrypted direct message"},
}

// Wired into relay.StoreEvent — fires once per event actually persisted,
// same hook point search.go/outbox.go's storage side would use.
//
// The ENTIRE body runs in its own goroutine, not just the actual send —
// a real bug caught live in production: store.subscriptionsFor() takes
// pushStore's mutex, and that mutex is also held (with a synchronous
// disk write) by add()/remove()/removeEndpoint() elsewhere. StoreEvent
// hooks run synchronously on the WS event-ingestion path — under real
// concurrent traffic, this meant every single incoming event (not just
// notification-worthy ones with subscribers) was momentarily blocked
// behind push-subscription lock contention, and at production load that
// pile-up was enough to make WS event handling appear to hang entirely
// (HTTP kept responding fine, since NIP-11 never touches this code path
// at all — only WS EVENT messages do). Dispatching the whole hook body
// async, so relay.StoreEvent's caller never blocks on this mutex at all.
func newPushNotifyHook(store *pushStore, vapidPublicKey, vapidPrivateKey, vapidSubscriber string) func(ctx context.Context, evt *nostr.Event) error {
	return func(ctx context.Context, evt *nostr.Event) error {
		if vapidPrivateKey == "" {
			return nil // push gating unset — degrade to a no-op, same pattern as unset DVM NWC
		}
		meta, ok := pushNotificationMeta[evt.Kind]
		if !ok {
			return nil
		}
		go dispatchPushNotifications(store, evt, meta, vapidPublicKey, vapidPrivateKey, vapidSubscriber)
		return nil
	}
}

func dispatchPushNotifications(store *pushStore, evt *nostr.Event, meta struct{ title, body string }, vapidPublicKey, vapidPrivateKey, vapidSubscriber string) {
	seen := map[string]bool{}
	for _, tag := range evt.Tags {
		if len(tag) < 2 || tag[0] != "p" {
			continue
		}
		recipient := tag[1]
		if recipient == evt.PubKey || seen[recipient] {
			continue // no self-notifications; no duplicate sends for multi-p-tag events
		}
		seen[recipient] = true
		for _, sub := range store.subscriptionsFor(recipient) {
			go sendPushNotification(store, sub, meta.title, meta.body, vapidPublicKey, vapidPrivateKey, vapidSubscriber)
		}
	}
}

func sendPushNotification(store *pushStore, sub pushSubscription, title, body, vapidPublicKey, vapidPrivateKey, vapidSubscriber string) {
	payload, err := json.Marshal(map[string]string{"title": title, "body": body})
	if err != nil {
		return
	}

	resp, err := webpush.SendNotification(payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		VAPIDPublicKey:  vapidPublicKey,
		VAPIDPrivateKey: vapidPrivateKey,
		Subscriber:      vapidSubscriber,
		TTL:             60,
	})
	if err != nil {
		log.Printf("push: send failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
		// The push service itself says this subscription is permanently
		// dead — clean it up so future events don't keep wasting a request
		// on it.
		store.removeEndpoint(sub.Endpoint)
	}
}
