package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip04"
)

// A minimal NIP-47 (Nostr Wallet Connect) client for the DVM operator's own
// receiving wallet — used to mint invoices and check whether they've been
// paid. This is a Go port of the same hand-rolled protocol implemented in
// client/src/lib/nwc.ts (no NWC client exists in go-nostr's core packages).
//
// mu guards relay: unlike the DVM's own connection to its NOSTRAS relay
// (which has a real reconnect-with-backoff loop, see main()'s "Reconnection
// loop" comment), this connection to the *wallet's* relay was, until
// 2026-09-01, established exactly once at startup with no reconnection
// logic at all — confirmed as the real root cause of a real, same-day,
// recurring "could not create invoice: not connected to wss://..." outage
// (a restart only ever gave temporary relief, since it just re-ran this
// same connect-once code path). call() now reconnects lazily on demand
// instead, checked under this mutex since concurrent jobs
// (`go handleJob(...)` per event) can call it at the same time.
type nwcClient struct {
	mu           sync.Mutex
	relay        *nostr.Relay
	sk           string
	pubkey       string
	walletPubkey string
}

func newNwcClient(ctx context.Context, uri string) (*nwcClient, error) {
	without := strings.TrimPrefix(uri, "nostr+walletconnect://")
	parts := strings.SplitN(without, "?", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid nostr+walletconnect:// URI")
	}
	walletPubkey := parts[0]
	q, err := url.ParseQuery(parts[1])
	if err != nil {
		return nil, err
	}
	relayURL := q.Get("relay")
	sk := q.Get("secret")
	if walletPubkey == "" || relayURL == "" || sk == "" {
		return nil, fmt.Errorf("invalid nostr+walletconnect:// URI: missing pubkey/relay/secret")
	}

	relay, err := nostr.RelayConnect(ctx, relayURL)
	if err != nil {
		return nil, fmt.Errorf("connecting to wallet relay: %w", err)
	}

	pubkey, err := nostr.GetPublicKey(sk)
	if err != nil {
		return nil, err
	}

	return &nwcClient{relay: relay, sk: sk, pubkey: pubkey, walletPubkey: walletPubkey}, nil
}

// ensureConnected reconnects to the wallet relay if the existing connection
// has died since it was established — see the type-level comment for why
// this exists (a dropped connection here used to be permanent until the
// whole DVM process restarted). A fresh connect attempt gets a bounded 10s
// timeout of its own so a genuinely unreachable wallet relay fails this one
// call rather than hanging it indefinitely.
func (c *nwcClient) ensureConnected(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.relay.IsConnected() {
		return nil
	}
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	relay, err := nostr.RelayConnect(connectCtx, c.relay.URL)
	if err != nil {
		return fmt.Errorf("reconnecting to wallet relay %s: %w", c.relay.URL, err)
	}
	c.relay = relay
	return nil
}

// call sends an encrypted NIP-47 request (kind 23194) and waits for the
// matching encrypted response (kind 23195).
func (c *nwcClient) call(ctx context.Context, method string, params any, timeout time.Duration) (json.RawMessage, error) {
	if err := c.ensureConnected(ctx); err != nil {
		return nil, err
	}

	c.mu.Lock()
	relay := c.relay
	c.mu.Unlock()

	body, err := json.Marshal(map[string]any{"method": method, "params": params})
	if err != nil {
		return nil, err
	}

	shared, err := nip04.ComputeSharedSecret(c.walletPubkey, c.sk)
	if err != nil {
		return nil, err
	}
	encrypted, err := nip04.Encrypt(string(body), shared)
	if err != nil {
		return nil, err
	}

	evt := nostr.Event{
		PubKey:    c.pubkey,
		CreatedAt: nostr.Now(),
		Kind:      23194,
		Tags:      nostr.Tags{{"p", c.walletPubkey}},
		Content:   encrypted,
	}
	if err := evt.Sign(c.sk); err != nil {
		return nil, err
	}

	subCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	sub, err := relay.Subscribe(subCtx, nostr.Filters{{
		Kinds:   []int{23195},
		Authors: []string{c.walletPubkey},
		Tags:    nostr.TagMap{"e": []string{evt.ID}},
	}})
	if err != nil {
		return nil, err
	}
	defer sub.Close()

	if err := relay.Publish(ctx, evt); err != nil {
		return nil, err
	}

	select {
	case respEvt := <-sub.Events:
		if respEvt == nil {
			return nil, fmt.Errorf("NWC subscription closed before a response arrived")
		}
		decrypted, err := nip04.Decrypt(respEvt.Content, shared)
		if err != nil {
			return nil, err
		}
		var parsed struct {
			ResultType string `json:"result_type"`
			Error      *struct {
				Message string `json:"message"`
			} `json:"error"`
			Result json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal([]byte(decrypted), &parsed); err != nil {
			return nil, err
		}
		if parsed.Error != nil {
			return nil, fmt.Errorf("wallet error: %s", parsed.Error.Message)
		}
		return parsed.Result, nil
	case <-subCtx.Done():
		return nil, fmt.Errorf("NWC %s request timed out", method)
	}
}

type nwcInvoice struct {
	Invoice     string `json:"invoice"`
	PaymentHash string `json:"payment_hash"`
	Amount      int64  `json:"amount"`
	SettledAt   *int64 `json:"settled_at"`
}

func (c *nwcClient) MakeInvoice(ctx context.Context, amountMsat int64, description string) (*nwcInvoice, error) {
	raw, err := c.call(ctx, "make_invoice", map[string]any{
		"amount":      amountMsat,
		"description": description,
	}, 15*time.Second)
	if err != nil {
		return nil, err
	}
	var inv nwcInvoice
	if err := json.Unmarshal(raw, &inv); err != nil {
		return nil, err
	}
	return &inv, nil
}

func (c *nwcClient) LookupInvoice(ctx context.Context, paymentHash string) (*nwcInvoice, error) {
	raw, err := c.call(ctx, "lookup_invoice", map[string]any{
		"payment_hash": paymentHash,
	}, 15*time.Second)
	if err != nil {
		return nil, err
	}
	var inv nwcInvoice
	if err := json.Unmarshal(raw, &inv); err != nil {
		return nil, err
	}
	return &inv, nil
}

// GetBalance is read-only — it can't move money, unlike a real pay_invoice
// call (which this DVM has never implemented and never will, per this
// project's own standing financial-safety rule: it only ever requests and
// displays invoices, a human always pays). Note this may legitimately fail
// with a wallet-side "unauthorized"-shaped error even when everything else
// works correctly: the operator's NWC connection was deliberately scoped at
// setup time to exactly the two permissions the rest of this file uses
// (make_invoice, lookup_invoice) — balance read is a separate grant some
// wallets require explicitly, and an operator who hasn't extended that scope
// will see this fail, by design, not by bug.
func (c *nwcClient) GetBalance(ctx context.Context) (int64, error) {
	raw, err := c.call(ctx, "get_balance", map[string]any{}, 10*time.Second)
	if err != nil {
		return 0, err
	}
	var result struct {
		Balance int64 `json:"balance"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return 0, err
	}
	return result.Balance, nil
}
