package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip44"
)

// NOSTRAS DVM: a NIP-90 Data Vending Machine offering text summarization
// (job kind 5001 -> result kind 6001), translation (job kind 5002 ->
// result kind 6002), general text generation / Q&A (job kind 5050 ->
// result kind 6050), and spam/scam classification (job kind 5501 ->
// result kind 6501, chosen adjacent to the community-registered 5500
// "Malware Scanning" kind as the better semantic neighbor — a safety/
// trust judgment, not a content-discovery job), per the NIP-90 kind
// registry. This is the proof-of-concept DVM from the roadmap's Phase 3,
// listening on the local relay only. Payment-gated (kind 7000
// "payment-required" + a real NWC-minted invoice) when
// NOSTRAS_DVM_NWC_URI is configured; free otherwise — see
// loadPaymentConfig. The price itself is computed per job from its
// actual expected API cost (see estimateJobCostSats) rather than charged
// flat.
const (
	kindJobRequestSummarize = 5001
	kindJobResultSummarize  = 6001
	kindJobRequestTranslate = 5002
	kindJobResultTranslate  = 6002
	kindJobRequestGenerate  = 5050
	kindJobResultGenerate   = 6050
	kindJobRequestModerate  = 5501
	kindJobResultModerate   = 6501
	// Paid long-form article unlock — 5904/6904, chosen from the vendored
	// NIP-90 kind registry (go-nostr's nip90/kinds.go, current through
	// 5970/6970) with nothing else registered nearby; re-checked against
	// the live upstream registry too, not just this vendored snapshot.
	// Genuinely different from every other job kind here: request AND
	// result payloads are meant to be private (NIP-90's own `["encrypted"]`
	// convention, NIP-44 rather than the spec's literal NIP-04 — same
	// deliberate deviation this project already made for NIP-17 DMs, for
	// the same reason: stronger crypto, less metadata leakage, and this
	// job kind is NOSTRAS-specific rather than depending on generic
	// third-party NIP-90 tooling interop). See handleArticleUnlockJob.
	kindJobRequestArticleUnlock = 5904
	kindJobResultArticleUnlock  = 6904
	kindJobFeedback             = 7000

	// NIP-89 handler information event, reused by NIP-90 (Appendix 2:
	// "Service provider discoverability") to advertise a DVM's supported
	// job kinds so clients that aren't NOSTRAS can discover and pay this
	// DVM directly, without ever installing the app. Republished (as a
	// replaceable event, same `d` tag) on every relay connection — see
	// runDVM — so it stays fresh and self-heals if a relay ever drops it.
	kindHandlerAnnouncement = 31990
	dvmHandlerDTag          = "nostras-dvm"

	// A second, separate kind:31990 (same event kind, different `d` tag)
	// advertising the NOSTRAS *client's* own NIP-23 article viewer, not
	// the DVM's job kinds — the app-level "enabler" NIP alongside the
	// DVM's service-provider one. Published by this same DVM identity
	// since it's the one stable, always-on server-side process this
	// project has; NOSTRAS itself has no single canonical identity (every
	// end user brings their own key), so there's nothing else that could
	// durably publish an app-level fact like this instead.
	dvmClientHandlerDTag = "nostras-client"
	kindArticle          = 30023

	dvmModel     = "claude-opus-5"
	dvmMaxTokens = 2048

	defaultPriceSats  = 21
	paymentPollEvery  = 3 * time.Second
	paymentWaitWindow = 2 * time.Minute

	// claude-opus-5 pricing (per shared/models.md — keep in sync if the
	// model ever changes). Job pricing is computed from these rather than
	// charged flat, so cost is at least roughly proportional to what the
	// job actually costs to run.
	inputPricePerMillionUSD  = 5.00
	outputPricePerMillionUSD = 25.00
	// Real output length is unknowable before generation runs — this is a
	// typical-case assumption (not the dvmMaxTokens worst case) so pricing
	// stays proportional to the question asked rather than pinned near the
	// cap for every job. A job that happens to generate an unusually long
	// answer costs the operator a little more than it charged; acceptable
	// at these price levels.
	estimatedOutputTokens = 500
	minJobPriceSats       = 1

	btcUsdRateURL     = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
	rateLookupTimeout = 5 * time.Second
)

// languageNames maps the ISO 639-1 codes the client sends (in a NIP-90
// "param" tag keyed "language") to the English name Claude is prompted
// with — keeps the wire format a standard short code while the prompt
// stays unambiguous.
var languageNames = map[string]string{
	"en": "English",
	"es": "Spanish",
	"fr": "French",
	"de": "German",
	"pt": "Portuguese",
	"it": "Italian",
	"ja": "Japanese",
	"zh": "Chinese",
}

const (
	summarizeSystemPrompt = "You summarize text concisely and accurately in 2-3 sentences. Respond with only the summary, no preamble or labels."
	generateSystemPrompt  = "You are a helpful, concise assistant answering a question asked through a Nostr client. Answer directly."
	// moderateSystemPrompt asks for a lightweight, prompted structured
	// convention (a strict JSON line, then a human-readable reason)
	// rather than using a separate Claude structured-output/tool-use
	// feature this DVM hasn't needed before — callClaude stays a plain
	// text completion either way. The client tries to parse line 1 for a
	// badge and always has the line-2+ reason as a fallback display, so a
	// malformed line 1 degrades gracefully rather than hard-failing.
	moderateSystemPrompt = `You are a content-safety classifier for a Nostr client. Given a single note's text, classify it as one of:
- spam: low-effort repetitive promotional content unrelated to genuine discourse (crypto pump schemes, fake job/freelance offers, engagement bait)
- scam: content designed to deceive for financial gain (phishing links, fake giveaways, impersonation, too-good-to-be-true investment offers)
- legit: neither of the above

Output exactly two lines, nothing else:
Line 1: a strict single-line JSON object {"verdict":"spam"|"scam"|"legit","confidence":"low"|"medium"|"high"}
Line 2: one sentence explaining why, in plain language.`
)

func translateSystemPrompt(targetLanguage string) string {
	return "You are a translation engine. Translate the user's text into " + targetLanguage + ". Respond with only the translated text — no preamble, no explanation, no quotation marks."
}

type paymentConfig struct {
	nwc *nwcClient
	// priceSats is a flat fallback only — used when the per-job cost
	// estimate can't be computed (token counting or the BTC/USD lookup
	// failed), not the primary price. See estimateJobCostSats.
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

	// Defaults to localhost for local dev; the Fly deployment sets this to
	// the relay's address on Fly's private network (see server/fly.toml)
	// instead of going out over the public internet.
	relayURL := os.Getenv("NOSTRAS_RELAY_URL")
	if relayURL == "" {
		relayURL = "ws://localhost:7777"
	}

	ctx := context.Background()
	payment := loadPaymentConfig(ctx)

	// Throwaway identity for this DVM *process's whole lifetime* — stays
	// stable across the relay reconnects below, so a client that already
	// received a payment-required from this pubkey still gets its result
	// from the same pubkey after a brief connection drop, not a new
	// random one it has no reason to trust.
	sk := nostr.GeneratePrivateKey()
	pk, _ := nostr.GetPublicKey(sk)

	// Deliberately a *separate* key from sk above, and — unlike sk — must
	// be persisted (nostras.env), not regenerated per boot: sk only needs
	// to be stable within one process's lifetime (jobs correlate by
	// request id, not by a client trusting the DVM's pubkey across
	// restarts), but articles are NIP-44-encrypted to this key at publish
	// time and need to stay decryptable indefinitely — a fresh-per-boot
	// key here would make every previously-published paid article
	// permanently unreadable the next time this process restarts (which
	// this project's own incident history shows happens often). Kept
	// separate from sk rather than reusing+persisting it, so a bug in this
	// still-new code path can't touch the four already-proven job kinds'
	// signing identity.
	articleKeySk := os.Getenv("NOSTRAS_DVM_ARTICLE_KEY")
	var articleKeyPk string
	if articleKeySk != "" {
		var err error
		articleKeyPk, err = nostr.GetPublicKey(articleKeySk)
		if err != nil {
			fmt.Println("warning: NOSTRAS_DVM_ARTICLE_KEY set but invalid, paid articles disabled:", err)
			articleKeySk = ""
		}
	}

	fmt.Println("NOSTRAS DVM (NIP-90 summarization 5001->6001, translation 5002->6002, text generation 5050->6050, moderation 5501->6501) running as", pk)
	if payment == nil {
		fmt.Println("payment gating: OFF (set NOSTRAS_DVM_NWC_URI to enable)")
	} else {
		fmt.Printf("payment gating: ON — priced per job from real token cost (fallback %d sats if pricing lookup fails)\n", payment.priceSats)
	}
	if articleKeySk == "" {
		fmt.Println("paid articles (5904->6904): OFF (set NOSTRAS_DVM_ARTICLE_KEY to enable)")
	} else {
		fmt.Println("paid articles (5904->6904): ON, encryption key", articleKeyPk)
	}

	healthPort := os.Getenv("NOSTRAS_DVM_HEALTH_PORT")
	if healthPort == "" {
		healthPort = "7778"
	}
	startHealthServer(healthPort, payment != nil)
	fmt.Println("health endpoint: private network only, :" + healthPort + "/health")

	// Reconnection loop. Previously a single dropped connection (network
	// blip, relay restart, etc.) closed sub.Events, the for-range below
	// ended, main() returned, and the process exited cleanly (code 0) —
	// which Fly does NOT restart automatically, unlike a crash. Confirmed
	// as the real root cause of most of this project's recurring "DVM
	// stopped" incidents by reading the actual boot logs directly: a
	// clean 20-90 minute run, then a silent exit with no panic, no error,
	// nothing to alert on until the next manual check or the scheduled
	// uptime-check workflow happened to catch it. Backoff resets to the
	// base interval once a connection has been stable for a while, so one
	// old failure doesn't leave a long-since-recovered DVM retrying
	// slowly forever.
	backoff := time.Second
	const maxBackoff = 30 * time.Second
	for {
		fmt.Println("listening on", relayURL)
		connectedAt := time.Now()
		err := runDVM(ctx, relayURL, claude, sk, articleKeySk, articleKeyPk, payment)
		if err != nil {
			fmt.Println("relay connection lost, reconnecting:", err)
		} else {
			fmt.Println("relay subscription ended, reconnecting")
		}
		if time.Since(connectedAt) > time.Minute {
			backoff = time.Second
		}
		time.Sleep(backoff)
		if backoff *= 2; backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

// runDVM connects to the relay, subscribes to job-request kinds, and
// processes jobs until the connection drops or the subscription's Events
// channel closes. Returns nil for a clean subscription end, or the error
// that caused the disconnect — either way, the caller's reconnection loop
// decides what happens next, this function never terminates the process.
func runDVM(ctx context.Context, relayURL string, claude anthropic.Client, sk, articleKeySk, articleKeyPk string, payment *paymentConfig) error {
	relay, err := nostr.RelayConnect(ctx, relayURL)
	if err != nil {
		return err
	}
	defer relay.Close()
	markRelayConnected(true)
	defer markRelayConnected(false)

	publishHandlerAnnouncement(ctx, relay, sk, articleKeyPk)
	publishClientHandlerAnnouncement(ctx, relay, sk)

	kinds := []int{kindJobRequestSummarize, kindJobRequestTranslate, kindJobRequestGenerate, kindJobRequestModerate}
	if articleKeySk != "" {
		kinds = append(kinds, kindJobRequestArticleUnlock)
	}
	since := nostr.Now()
	sub, err := relay.Subscribe(ctx, nostr.Filters{{
		Kinds: kinds,
		Since: &since,
	}})
	if err != nil {
		return err
	}

	for evt := range sub.Events {
		go handleJob(ctx, relay, claude, sk, articleKeySk, payment, evt)
	}
	return nil
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

	// Flat fallback price, only used if per-job cost estimation fails.
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

func handleJob(ctx context.Context, relay *nostr.Relay, claude anthropic.Client, sk, articleKeySk string, payment *paymentConfig, req *nostr.Event) {
	// Structurally separate path, not a case in the switch below:
	// decrypting a paid article bears no resemblance to "prompt Claude
	// with some text," which is the one thing every other job kind here
	// shares. Keeping it fully outside handleJob's shared body means a
	// bug in this still-new code can't touch the four already-proven,
	// real-money job kinds' request handling at all.
	if req.Kind == kindJobRequestArticleUnlock {
		handleArticleUnlockJob(ctx, relay, sk, articleKeySk, payment, req)
		return
	}

	markJobReceived()

	var resultKind int
	var systemPrompt string

	switch req.Kind {
	case kindJobRequestSummarize:
		resultKind = kindJobResultSummarize
		systemPrompt = summarizeSystemPrompt
	case kindJobRequestTranslate:
		resultKind = kindJobResultTranslate
		langTag := req.Tags.Find("param")
		if len(langTag) < 3 || langTag[1] != "language" || strings.TrimSpace(langTag[2]) == "" {
			publishFeedback(ctx, relay, sk, req, "error", `missing required param tag ["param","language",<code>]`)
			return
		}
		langName, ok := languageNames[langTag[2]]
		if !ok {
			publishFeedback(ctx, relay, sk, req, "error", "unsupported language code "+langTag[2])
			return
		}
		systemPrompt = translateSystemPrompt(langName)
	case kindJobRequestGenerate:
		resultKind = kindJobResultGenerate
		systemPrompt = generateSystemPrompt
	case kindJobRequestModerate:
		resultKind = kindJobResultModerate
		systemPrompt = moderateSystemPrompt
	default:
		publishFeedback(ctx, relay, sk, req, "error", "unsupported job kind")
		return
	}

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
		amountSats := estimateJobCostSats(ctx, claude, systemPrompt, text, payment.priceSats)
		paid, err := requirePayment(ctx, relay, sk, payment, req, amountSats)
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

	result, err := callClaude(ctx, claude, systemPrompt, text)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "job failed: "+err.Error())
		return
	}

	publishResult(ctx, relay, sk, req, resultKind, result)
}

// handleArticleUnlockJob decrypts a paid NIP-23 article for a paying
// reader. Request encryption is optional per NIP-90's own spec ("if the
// user wants to keep params secret, they can encrypt") — a plain,
// unencrypted `i` tag is accepted too, mainly so this can be exercised
// directly via `nak` without hand-rolling NIP-44, but the real client
// always encrypts (see ArticleComposer/the unlock button). When the
// request *is* encrypted, its payload tags were JSON-stringified into
// `content` then NIP-44-encrypted by the sender (NDK's own
// NDKDVMRequest.encryption() does exactly this) — decrypt and
// JSON-unmarshal back into real tags before looking for `i`.
//
// The result, by contrast, is always a *direct* NIP-44 ciphertext of the
// article's plaintext body straight in `content` (not the tag-JSON-
// wrapping convention) — the spec's own literal wording for job results
// ("output should be encrypted and placed in content field"), simplest
// for a payload that's just one blob of text, not structured params. The
// client decrypts it with a plain signer.decrypt(...) call, not NDK's
// NDKDVMJobFeedback.dvmDecrypt() (that class's tag-wrapping convention is
// for kind:7000 feedback events specifically, not kind:6xxx results).
// hasTag checks for a tag's mere presence, unlike nostr.Tags.Find (which
// requires len(tag) >= 2, "a key with at least one value" — real bug hit
// while verifying this: NIP-90's own `["encrypted"]` marker convention,
// and NDK's NDKDVMRequest.encryption() which produces that exact
// single-element tag, are both length-1, so Find("encrypted") silently
// never matches them and every encrypted request looked unencrypted.
// Confirmed live with a real nak-constructed encrypted request before
// this fix (wrongly treated as unencrypted, "missing i tag" error) and
// after (correctly decrypted).
func hasTag(tags nostr.Tags, key string) bool {
	for _, t := range tags {
		if len(t) >= 1 && t[0] == key {
			return true
		}
	}
	return false
}

func handleArticleUnlockJob(ctx context.Context, relay *nostr.Relay, sk, articleKeySk string, payment *paymentConfig, req *nostr.Event) {
	markJobReceived()

	tags := req.Tags
	encryptedReq := hasTag(req.Tags, "encrypted")
	if encryptedReq {
		convKey, err := nip44.GenerateConversationKey(req.PubKey, articleKeySk)
		if err != nil {
			publishFeedback(ctx, relay, sk, req, "error", "could not derive decryption key")
			return
		}
		decrypted, err := nip44.Decrypt(req.Content, convKey)
		if err != nil {
			publishFeedback(ctx, relay, sk, req, "error", "could not decrypt job request")
			return
		}
		var restoredTags nostr.Tags
		if err := json.Unmarshal([]byte(decrypted), &restoredTags); err != nil {
			publishFeedback(ctx, relay, sk, req, "error", "malformed encrypted request payload")
			return
		}
		tags = restoredTags
	}

	iTag := tags.Find("i")
	if len(iTag) < 3 || iTag[2] != "event" {
		publishFeedback(ctx, relay, sk, req, "error", `missing required i tag referencing the article (["i", "<article-event-id>", "event"])`)
		return
	}
	articleID := iTag[1]

	found, err := relay.QuerySync(ctx, nostr.Filter{IDs: []string{articleID}})
	if err != nil || len(found) == 0 {
		publishFeedback(ctx, relay, sk, req, "error", "could not find referenced article "+articleID)
		return
	}
	article := found[0]

	if !hasTag(article.Tags, "encrypted") {
		publishFeedback(ctx, relay, sk, req, "error", "this article is not a paid article")
		return
	}
	priceTag := article.Tags.Find("price")
	if len(priceTag) < 2 {
		publishFeedback(ctx, relay, sk, req, "error", "this article has no price set")
		return
	}
	priceSats, err := strconv.ParseInt(priceTag[1], 10, 64)
	if err != nil || priceSats <= 0 {
		publishFeedback(ctx, relay, sk, req, "error", "this article has an invalid price")
		return
	}

	articleConvKey, err := nip44.GenerateConversationKey(article.PubKey, articleKeySk)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "could not derive article decryption key")
		return
	}
	plaintext, err := nip44.Decrypt(article.Content, articleConvKey)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "could not decrypt article content")
		return
	}

	// Same operator wallet as every other job kind, not the article
	// author's own — "author sets the price" means the author controls
	// what NOSTRAS charges on their content's behalf, not that payment is
	// automatically routed to them. Real, deliberate simplification, not
	// an oversight: automatic revenue sharing is a separate business/
	// product decision, not built here.
	if payment != nil {
		paid, err := requirePayment(ctx, relay, sk, payment, req, priceSats)
		if err != nil {
			publishFeedback(ctx, relay, sk, req, "error", err.Error())
			return
		}
		if !paid {
			return
		}
	}

	publishFeedback(ctx, relay, sk, req, "processing", "")

	requesterConvKey, err := nip44.GenerateConversationKey(req.PubKey, articleKeySk)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "could not encrypt result")
		return
	}
	ciphertext, err := nip44.Encrypt(plaintext, requesterConvKey)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "could not encrypt result")
		return
	}

	publishArticleUnlockResult(ctx, relay, sk, req, ciphertext, encryptedReq)
}

func publishArticleUnlockResult(ctx context.Context, relay *nostr.Relay, sk string, req *nostr.Event, ciphertext string, encrypted bool) {
	tags := nostr.Tags{
		{"e", req.ID},
		{"p", req.PubKey},
	}
	if encrypted {
		tags = append(tags, nostr.Tag{"encrypted"})
	}
	evt := nostr.Event{
		Kind:      kindJobResultArticleUnlock,
		CreatedAt: nostr.Now(),
		Content:   ciphertext,
		Tags:      tags,
	}
	signAndPublish(ctx, relay, sk, evt)
}

// estimateJobCostSats prices a job proportionally to its actual expected
// API cost: exact input tokens via the real count_tokens endpoint (free to
// call, runs no inference), plus a typical-case assumption for the
// un-knowable output length. Falls back to the operator's flat default
// price if token counting or the live BTC/USD rate lookup fails, rather
// than blocking the job — same degrade-gracefully philosophy as
// loadPaymentConfig.
func estimateJobCostSats(ctx context.Context, claude anthropic.Client, systemPrompt, userText string, fallbackSats int64) int64 {
	count, err := claude.Messages.CountTokens(ctx, anthropic.MessageCountTokensParams{
		Model:  dvmModel,
		System: anthropic.MessageCountTokensParamsSystemUnion{OfString: param.NewOpt(systemPrompt)},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(userText)),
		},
	})
	if err != nil {
		fmt.Println("token count failed, falling back to flat price:", err)
		return fallbackSats
	}

	usd := float64(count.InputTokens)/1_000_000*inputPricePerMillionUSD +
		float64(estimatedOutputTokens)/1_000_000*outputPricePerMillionUSD

	btcUsd, err := fetchBTCUSDRate(ctx)
	if err != nil {
		fmt.Println("BTC/USD rate lookup failed, falling back to flat price:", err)
		return fallbackSats
	}

	sats := int64(math.Ceil(usd / btcUsd * 100_000_000))
	if sats < minJobPriceSats {
		sats = minJobPriceSats
	}
	return sats
}

func fetchBTCUSDRate(ctx context.Context) (float64, error) {
	ctx, cancel := context.WithTimeout(ctx, rateLookupTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, btcUsdRateURL, nil)
	if err != nil {
		return 0, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("rate lookup returned status %d", resp.StatusCode)
	}

	var body struct {
		Bitcoin struct {
			USD float64 `json:"usd"`
		} `json:"bitcoin"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, err
	}
	if body.Bitcoin.USD <= 0 {
		return 0, fmt.Errorf("rate lookup returned an invalid rate")
	}
	return body.Bitcoin.USD, nil
}

// requirePayment mints a real invoice via the operator's NWC wallet,
// publishes it as a NIP-90 "payment-required" feedback event, and polls the
// wallet until the invoice is settled or the wait window expires.
func requirePayment(ctx context.Context, relay *nostr.Relay, sk string, payment *paymentConfig, req *nostr.Event, amountSats int64) (bool, error) {
	amountMsat := amountSats * 1000
	inv, err := payment.nwc.MakeInvoice(ctx, amountMsat, "NOSTRAS DVM job "+req.ID[:8])
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

// callClaude is the single place every job kind calls the Claude API —
// summarization, translation, and text generation only differ by which
// system prompt they pass in.
func callClaude(ctx context.Context, claude anthropic.Client, systemPrompt, userText string) (string, error) {
	resp, err := claude.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     dvmModel,
		MaxTokens: dvmMaxTokens,
		System: []anthropic.TextBlockParam{
			{Text: systemPrompt},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(userText)),
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

// publishHandlerAnnouncement advertises this DVM per NIP-89/NIP-90's
// service-provider-discoverability appendix: a single kind:31990 event
// listing every job kind this DVM handles, so a generic NIP-90-aware
// client or marketplace can find and pay it directly. Content is static
// (kind:0-style JSON), deliberately not a live price — the actual price
// is dynamic per job (see estimateJobCostSats), so the description gives
// a representative price band instead of a number that would go stale.
func publishHandlerAnnouncement(ctx context.Context, relay *nostr.Relay, sk, articleKeyPk string) {
	about := "Claude-powered NIP-90 jobs: summarize (5001), translate (5002), free-form ask (5050), spam/scam classification (5501). Priced per job from real token cost — typically a few dozen sats — and you only pay if the job completes."
	tags := nostr.Tags{
		{"d", dvmHandlerDTag},
		{"k", strconv.Itoa(kindJobRequestSummarize)},
		{"k", strconv.Itoa(kindJobRequestTranslate)},
		{"k", strconv.Itoa(kindJobRequestGenerate)},
		{"k", strconv.Itoa(kindJobRequestModerate)},
	}
	if articleKeyPk != "" {
		about += " Paid long-form article unlock (5904) — the author sets the price; decrypted content is NIP-44-encrypted back to you specifically, not published in the clear."
		tags = append(tags, nostr.Tag{"k", strconv.Itoa(kindJobRequestArticleUnlock)})
	}

	// articleEncryptionPubkey, present only when paid articles are
	// enabled, is a *separate* field from this event's own signing
	// pubkey (evt.PubKey, set by signAndPublish below) — that key is only
	// stable for this process's lifetime (see main()'s own comment on
	// why), while this one is persisted and must stay constant for
	// authors to encrypt articles against long-term. Clients that want to
	// publish a paid article read this field, not the announcement
	// event's own pubkey.
	content, err := json.Marshal(struct {
		Name                    string `json:"name"`
		About                   string `json:"about"`
		Picture                 string `json:"picture"`
		Website                 string `json:"website"`
		ArticleEncryptionPubkey string `json:"articleEncryptionPubkey,omitempty"`
	}{
		Name:                    "NOSTRAS DVM",
		About:                   about,
		Picture:                 "https://app.nostras.app/pwa-512x512.png",
		Website:                 "https://nostras.app",
		ArticleEncryptionPubkey: articleKeyPk,
	})
	if err != nil {
		fmt.Println("handler announcement marshal error:", err)
		return
	}

	evt := nostr.Event{
		Kind:      kindHandlerAnnouncement,
		CreatedAt: nostr.Now(),
		Content:   string(content),
		Tags:      tags,
	}
	signAndPublish(ctx, relay, sk, evt)
}

// publishClientHandlerAnnouncement advertises NOSTRAS the client (not the
// DVM) as a NIP-23 (kind:30023) long-form article handler, per the same
// NIP-89 mechanism — deliberately scoped to just this one kind, the
// genuinely differentiated capability NOSTRAS adds (real compose + reading
// view), rather than also claiming kind:0/kind:1, which every baseline
// client already handles and isn't the "unknown event-kind" scenario
// NIP-89 exists for. The `web` tag's <bech32> placeholder is filled in by
// the discovering client per NIP-89 with a real naddr; client/src/lib/
// deeplink.ts is what makes that URL actually resolve once someone lands
// on it, via the same `?nostr=` query param.
func publishClientHandlerAnnouncement(ctx context.Context, relay *nostr.Relay, sk string) {
	content, err := json.Marshal(struct {
		Name    string `json:"name"`
		About   string `json:"about"`
		Picture string `json:"picture"`
		Website string `json:"website"`
	}{
		Name:    "NOSTRAS",
		About:   "A Nostr PWA client with real NIP-23 long-form article support — compose and read articles inline, not just plain text.",
		Picture: "https://app.nostras.app/pwa-512x512.png",
		Website: "https://app.nostras.app",
	})
	if err != nil {
		fmt.Println("client handler announcement marshal error:", err)
		return
	}

	evt := nostr.Event{
		Kind:      kindHandlerAnnouncement,
		CreatedAt: nostr.Now(),
		Content:   string(content),
		Tags: nostr.Tags{
			{"d", dvmClientHandlerDTag},
			{"k", strconv.Itoa(kindArticle)},
			{"web", "https://app.nostras.app/?nostr=<bech32>", "naddr"},
		},
	}
	signAndPublish(ctx, relay, sk, evt)
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

func publishResult(ctx context.Context, relay *nostr.Relay, sk string, req *nostr.Event, resultKind int, result string) {
	reqJSON, _ := json.Marshal(req)
	evt := nostr.Event{
		Kind:      resultKind,
		CreatedAt: nostr.Now(),
		Content:   result,
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
