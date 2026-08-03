package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/nbd-wtf/go-nostr"
)

// NOSTRAS DVM: a NIP-90 Data Vending Machine offering text summarization
// (job kind 5001 -> result kind 6001, per the NIP-90 kind registry). This is
// the proof-of-concept DVM from the roadmap's Phase 3, listening on the
// local relay only. Payment-gated (kind 7000 "payment-required" + a real
// NWC-minted invoice) when NOSTRAS_DVM_NWC_URI is configured; free
// otherwise — see loadPaymentConfig.
const (
	relayURL        = "ws://localhost:7777"
	kindJobRequest  = 5001
	kindJobResult   = 6001
	kindJobFeedback = 7000

	defaultPriceSats  = 21
	paymentPollEvery  = 3 * time.Second
	paymentWaitWindow = 2 * time.Minute
)

type paymentConfig struct {
	nwc       *nwcClient
	priceSats int64
}

func main() {
	loadEnvFile("../nostras.env")

	apiKey := os.Getenv("NOSTRAS_ANTHROPIC_API_KEY")
	if apiKey == "" {
		fmt.Println("NOSTRAS_ANTHROPIC_API_KEY not set (checked environment and ../nostras.env)")
		os.Exit(1)
	}
	claude := anthropic.NewClient(option.WithAPIKey(apiKey))

	ctx := context.Background()
	relay, err := nostr.RelayConnect(ctx, relayURL)
	if err != nil {
		panic(err)
	}

	payment := loadPaymentConfig(ctx)

	// Throwaway identity for this DVM instance. It never touches the user's
	// real key material — it's just the pubkey the DVM signs job
	// feedback/results with.
	sk := nostr.GeneratePrivateKey()
	pk, _ := nostr.GetPublicKey(sk)
	fmt.Println("NOSTRAS DVM (NIP-90 summarization, kind 5001 -> 6001) running as", pk)
	fmt.Println("listening on", relayURL)
	if payment == nil {
		fmt.Println("payment gating: OFF (set NOSTRAS_DVM_NWC_URI to enable)")
	} else {
		fmt.Printf("payment gating: ON — %d sats per job\n", payment.priceSats)
	}

	since := nostr.Now()
	sub, err := relay.Subscribe(ctx, nostr.Filters{{Kinds: []int{kindJobRequest}, Since: &since}})
	if err != nil {
		panic(err)
	}

	for evt := range sub.Events {
		go handleJob(ctx, relay, claude, sk, payment, evt)
	}
}

// loadPaymentConfig reads the DVM operator's own receiving wallet from
// NOSTRAS_DVM_NWC_URI. Unset -> nil -> the DVM runs free, same as before.
// A configured-but-unreachable wallet degrades to free mode too (with a
// warning) rather than taking the whole DVM down.
func loadPaymentConfig(ctx context.Context) *paymentConfig {
	uri := os.Getenv("NOSTRAS_DVM_NWC_URI")
	if uri == "" {
		return nil
	}

	price := int64(defaultPriceSats)
	if v := os.Getenv("NOSTRAS_DVM_PRICE_SATS"); v != "" {
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil && parsed > 0 {
			price = parsed
		}
	}

	client, err := newNwcClient(ctx, uri)
	if err != nil {
		fmt.Println("warning: NOSTRAS_DVM_NWC_URI set but could not connect, running free:", err)
		return nil
	}

	return &paymentConfig{nwc: client, priceSats: price}
}

func handleJob(ctx context.Context, relay *nostr.Relay, claude anthropic.Client, sk string, payment *paymentConfig, req *nostr.Event) {
	iTag := req.Tags.Find("i")
	if len(iTag) < 2 {
		publishFeedback(ctx, relay, sk, req, "error", "missing required i tag (input)")
		return
	}

	text := iTag[1]
	inputType := ""
	if len(iTag) > 2 {
		inputType = iTag[2]
	}

	if inputType == "event" {
		found, err := relay.QuerySync(ctx, nostr.Filter{IDs: []string{text}})
		if err != nil || len(found) == 0 {
			publishFeedback(ctx, relay, sk, req, "error", "could not find referenced event "+text)
			return
		}
		text = found[0].Content
	}

	if strings.TrimSpace(text) == "" {
		publishFeedback(ctx, relay, sk, req, "error", "input is empty")
		return
	}

	if payment != nil {
		paid, err := requirePayment(ctx, relay, sk, payment, req)
		if err != nil {
			publishFeedback(ctx, relay, sk, req, "error", err.Error())
			return
		}
		if !paid {
			// requirePayment already published the "payment not received"
			// feedback on timeout.
			return
		}
	}

	publishFeedback(ctx, relay, sk, req, "processing", "")

	summary, err := summarize(ctx, claude, text)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "summarization failed: "+err.Error())
		return
	}

	publishResult(ctx, relay, sk, req, summary)
}

// requirePayment mints a real invoice via the operator's NWC wallet,
// publishes it as a NIP-90 "payment-required" feedback event, and polls the
// wallet until the invoice is settled or the wait window expires.
func requirePayment(ctx context.Context, relay *nostr.Relay, sk string, payment *paymentConfig, req *nostr.Event) (bool, error) {
	amountMsat := payment.priceSats * 1000
	inv, err := payment.nwc.MakeInvoice(ctx, amountMsat, "NOSTRAS DVM summarization job "+req.ID[:8])
	if err != nil {
		return false, fmt.Errorf("could not create invoice: %w", err)
	}

	publishPaymentRequired(ctx, relay, sk, req, amountMsat, inv.Invoice)

	deadline := time.Now().Add(paymentWaitWindow)
	for time.Now().Before(deadline) {
		time.Sleep(paymentPollEvery)
		status, err := payment.nwc.LookupInvoice(ctx, inv.PaymentHash)
		if err != nil {
			continue // transient lookup failure — keep polling until the deadline
		}
		if status.SettledAt != nil && *status.SettledAt > 0 {
			return true, nil
		}
	}

	publishFeedback(ctx, relay, sk, req, "error", "payment not received in time")
	return false, nil
}

func summarize(ctx context.Context, claude anthropic.Client, text string) (string, error) {
	resp, err := claude.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     "claude-opus-5",
		MaxTokens: 2048,
		System: []anthropic.TextBlockParam{
			{Text: "You summarize text concisely and accurately in 2-3 sentences. Respond with only the summary, no preamble or labels."},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(text)),
		},
	})
	if err != nil {
		return "", err
	}
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			return tb.Text, nil
		}
	}
	return "", fmt.Errorf("no text content in response")
}

func publishFeedback(ctx context.Context, relay *nostr.Relay, sk string, req *nostr.Event, status, message string) {
	evt := nostr.Event{
		Kind:      kindJobFeedback,
		CreatedAt: nostr.Now(),
		Content:   message,
		Tags: nostr.Tags{
			{"status", status},
			{"e", req.ID},
			{"p", req.PubKey},
		},
	}
	signAndPublish(ctx, relay, sk, evt)
}

func publishPaymentRequired(ctx context.Context, relay *nostr.Relay, sk string, req *nostr.Event, amountMsat int64, bolt11 string) {
	evt := nostr.Event{
		Kind:      kindJobFeedback,
		CreatedAt: nostr.Now(),
		Content:   "",
		Tags: nostr.Tags{
			{"status", "payment-required"},
			{"amount", strconv.FormatInt(amountMsat, 10), bolt11},
			{"e", req.ID},
			{"p", req.PubKey},
		},
	}
	signAndPublish(ctx, relay, sk, evt)
}

func publishResult(ctx context.Context, relay *nostr.Relay, sk string, req *nostr.Event, summary string) {
	reqJSON, _ := json.Marshal(req)
	evt := nostr.Event{
		Kind:      kindJobResult,
		CreatedAt: nostr.Now(),
		Content:   summary,
		Tags: nostr.Tags{
			{"e", req.ID},
			{"p", req.PubKey},
			{"request", string(reqJSON)},
		},
	}
	signAndPublish(ctx, relay, sk, evt)
}

func signAndPublish(ctx context.Context, relay *nostr.Relay, sk string, evt nostr.Event) {
	if err := evt.Sign(sk); err != nil {
		fmt.Println("sign error:", err)
		return
	}
	if err := relay.Publish(ctx, evt); err != nil {
		fmt.Println("publish error:", err)
	}
}

// loadEnvFile does a minimal KEY=VALUE .env parse, only filling in variables
// not already set in the environment. Missing file is not an error — the
// caller falls back to a real env var if nostras.env isn't present.
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if os.Getenv(key) == "" {
			os.Setenv(key, value)
		}
	}
}
