package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip04"
)

// A minimal NIP-47 (Nostr Wallet Connect) client for the DVM operator's own
// receiving wallet — used to mint invoices and check whether they've been
// paid. This is a Go port of the same hand-rolled protocol implemented in
// client/src/lib/nwc.ts (no NWC client exists in go-nostr's core packages).
type nwcClient struct {
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

// call sends an encrypted NIP-47 request (kind 23194) and waits for the
// matching encrypted response (kind 23195).
func (c *nwcClient) call(ctx context.Context, method string, params any, timeout time.Duration) (json.RawMessage, error) {
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

	sub, err := c.relay.Subscribe(subCtx, nostr.Filters{{
		Kinds:   []int{23195},
		Authors: []string{c.walletPubkey},
		Tags:    nostr.TagMap{"e": []string{evt.ID}},
	}})
	if err != nil {
		return nil, err
	}
	defer sub.Close()

	if err := c.relay.Publish(ctx, evt); err != nil {
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
