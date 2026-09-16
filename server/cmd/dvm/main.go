package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"sort"
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

	// Paid Communities — "pay to post" in a NIP-29 group (server/nip29.go
	// enforces the actual gate). 5906/6906, checked both against the
	// vendored NIP-90 kind registry (go-nostr's nip90/kinds.go — 5900/
	// 5901/5905/5970 taken nearby, nothing at 5906) and the live upstream
	// registry (github.com/nostr-protocol/data-vending-machines/kinds —
	// only 5900.md/5901.md/5905.md/5970.md exist), same discipline as
	// every prior job kind pick here. Unlike the article-unlock job, the
	// request/result here carry nothing private (a pubkey wanting to
	// join a public group isn't sensitive), so this reuses the plain,
	// unencrypted job-request shape the four original job kinds already
	// use — no NIP-44 wrapping needed.
	kindJobRequestCommunityJoin = 5906
	kindJobResultCommunityJoin  = 6906

	// Marketplace "Buy Now" purchase confirmation — 5907/6907, the next
	// free slot in the same custom 590x cluster paid-article-unlock
	// (5904) and paid-community-join (5906) already live in. Checked
	// against the vendored NIP-90 kind registry (go-nostr's
	// nip90/kinds.go — 5900/5901/5905/5970 taken nearby, nothing at
	// 5907), the live upstream registry (github.com/nostr-protocol/
	// data-vending-machines/kinds — same four files, no 5907.md), and
	// NDK's own NDKKind enum (no entry at all), same discipline as
	// every prior job kind pick here. Structurally the DVM cannot sign
	// as the listing's own seller (unlike Communities, there's no
	// persisted "listing-admin" key concept), so this job's actual
	// output is a real, independently-verifiable NIP-32 label (see
	// publishMarketplaceLabel) attesting the seller was paid — not a
	// state change to the listing itself, which stays the seller's own
	// action, same fetch-then-merge republish every other owner-edit in
	// this app already uses.
	kindJobRequestListingPurchase = 5907
	kindJobResultListingPurchase  = 6907
	kindListing                   = 30402

	kindJobFeedback = 7000

	// NIP-32 labeling — see publishModerationLabel. A moderate-job result
	// gets published a second time as a real, standard kind:1985 label
	// (not just the ephemeral kind:6501 response the requesting client
	// happens to parse), so any NIP-32-aware client or relay can query
	// for it independently of ever having run this exact job.
	kindLabel                = 1985
	moderationLabelNamespace = "org.nostras.moderation"
	// A second, separate NIP-32 namespace for marketplace purchase
	// receipts — see publishMarketplaceLabel. Distinct from the
	// moderation namespace above; same kindLabel (1985), different `L`
	// value, so the two never collide despite sharing an event kind.
	marketplaceLabelNamespace = "org.nostras.marketplace"

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

	// The article's author-set price is now paid directly to the author
	// (a real NIP-57 zap on the article, verified via a Lightning
	// payment preimage — see handleArticleUnlockJob) rather than to this
	// DVM's own wallet. NOSTRAS keeps only this small flat fee for
	// running the unlock/decryption service — chosen to match the
	// existing flat defaultPriceSats convention, since the DVM's real
	// marginal cost per unlock is near-zero (unlike the Claude-API-
	// cost-driven jobs, which price dynamically).
	articleAuthorPayoutFeeSats = 21

	// Same shape and reasoning as articleAuthorPayoutFeeSats: the group's
	// own price goes straight to whoever the group names as payout
	// recipient; this is NOSTRAS's own flat fee for running the join/
	// admission service, near-zero marginal cost either way.
	communityJoinFeeSats = 21

	// Same shape and reasoning again: a listing's own price goes
	// straight to the seller; this is NOSTRAS's own flat fee for
	// running the purchase-confirmation/receipt service. Reuses the
	// existing flat-fee convention rather than a dedicated env var —
	// one can be added later if a different rate is ever wanted.
	marketplacePurchaseFeeSats = 21

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
	loadEnvFile("../.nostras.env")

	apiKey := os.Getenv("NOSTRAS_ANTHROPIC_API_KEY")
	if apiKey == "" {
		fmt.Println("NOSTRAS_ANTHROPIC_API_KEY not set (checked environment and ../.nostras.env)")
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

	// Was unconditionally ephemeral (regenerated every boot) until
	// 2026-09-16 — a real, live finding from an external NIP-90 researcher
	// (nilo_agent, a self-disclosed AI agent) who ran a reproducible scan
	// against our own DVM pubkey and got back a real, verified zero: not
	// just no job activity, but no kind:0 and no kind:31990 at all on
	// standard discovery relays. Root cause, confirmed by reading this
	// file: publishHandlerAnnouncement only ever published to our own
	// relay, and this key regenerated on every restart — so even a fix to
	// the publish targets alone would leave every external index chasing
	// a moving pubkey. "Jobs correlate by request id, not by a client
	// trusting the DVM's pubkey across restarts" (the original reasoning
	// for ephemeral) is still true and still fine — it just never
	// required instability, and instability is actively harmful for
	// discovery, which this app's own /tools page now leads with as the
	// growth strategy. NOSTRAS_DVM_IDENTITY_KEY, if set, makes this the
	// DVM's real stable public identity across restarts — job feedback/
	// results, the handler announcements, and the DVM's own kind:0
	// profile (see publishDvmProfile) all sign with the same key now, so
	// a client that discovers the DVM via a stable announcement pubkey
	// gets job responses from that identical pubkey, not a different one.
	// Unset falls back to the original ephemeral behavior unchanged — this
	// is additive, never a requirement to keep the DVM running.
	sk := os.Getenv("NOSTRAS_DVM_IDENTITY_KEY")
	if sk != "" {
		if _, err := nostr.GetPublicKey(sk); err != nil {
			fmt.Println("warning: NOSTRAS_DVM_IDENTITY_KEY set but invalid, falling back to an ephemeral identity:", err)
			sk = ""
		}
	}
	if sk == "" {
		sk = nostr.GeneratePrivateKey()
	}
	pk, _ := nostr.GetPublicKey(sk)

	// Deliberately a *separate* key from sk above, and — unlike sk — must
	// be persisted (.nostras.env), not regenerated per boot: sk only needs
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

	// Same reasoning as articleKeySk above, same real problem in a
	// different shape: the pubkey this DVM promotes to admin of a paid
	// group has to stay stable across restarts, or every restart would
	// silently strip its own ability to admit new paying members (the
	// relay's own admin cache would still list the *old* ephemeral sk's
	// pubkey as admin, which this process no longer controls). Kept as
	// its own separate persisted key, not reused from articleKeySk, so a
	// bug in this still-newer code path can't touch the article-unlock
	// identity either.
	communityKeySk := os.Getenv("NOSTRAS_DVM_COMMUNITY_KEY")
	var communityKeyPk string
	if communityKeySk != "" {
		var err error
		communityKeyPk, err = nostr.GetPublicKey(communityKeySk)
		if err != nil {
			fmt.Println("warning: NOSTRAS_DVM_COMMUNITY_KEY set but invalid, paid communities disabled:", err)
			communityKeySk = ""
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
	if communityKeySk == "" {
		fmt.Println("paid communities (5906->6906): OFF (set NOSTRAS_DVM_COMMUNITY_KEY to enable)")
	} else {
		fmt.Println("paid communities (5906->6906): ON, admin key", communityKeyPk)
	}

	healthPort := os.Getenv("NOSTRAS_DVM_HEALTH_PORT")
	if healthPort == "" {
		healthPort = "7778"
	}
	startHealthServer(healthPort, payment)
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
		err := runDVM(ctx, relayURL, claude, sk, articleKeySk, articleKeyPk, communityKeySk, communityKeyPk, payment)
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
func runDVM(ctx context.Context, relayURL string, claude anthropic.Client, sk, articleKeySk, articleKeyPk, communityKeySk, communityKeyPk string, payment *paymentConfig) error {
	relay, err := nostr.RelayConnect(ctx, relayURL)
	if err != nil {
		return err
	}
	defer relay.Close()
	markRelayConnected(true)
	defer markRelayConnected(false)

	handlerEvt := publishHandlerAnnouncement(ctx, relay, sk, articleKeyPk, communityKeyPk)
	clientHandlerEvt := publishClientHandlerAnnouncement(ctx, relay, sk)
	dvmAbout, _ := dvmAboutAndTags(articleKeyPk, communityKeyPk)
	profileEvt := publishDvmProfile(ctx, relay, sk, dvmAbout)

	var discoveryEvts []nostr.Event
	for _, evt := range []nostr.Event{handlerEvt, clientHandlerEvt, profileEvt} {
		if evt.Sig != "" {
			discoveryEvts = append(discoveryEvts, evt)
		}
	}
	if len(discoveryEvts) > 0 {
		publishToDiscoveryRelays(ctx, discoveryEvts)
	}

	kinds := []int{kindJobRequestSummarize, kindJobRequestTranslate, kindJobRequestGenerate, kindJobRequestModerate, kindJobRequestListingPurchase}
	if articleKeySk != "" {
		kinds = append(kinds, kindJobRequestArticleUnlock)
	}
	if communityKeySk != "" {
		kinds = append(kinds, kindJobRequestCommunityJoin)
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
		go handleJob(ctx, relay, claude, sk, articleKeySk, communityKeySk, payment, evt)
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

func handleJob(ctx context.Context, relay *nostr.Relay, claude anthropic.Client, sk, articleKeySk, communityKeySk string, payment *paymentConfig, req *nostr.Event) {
	// Structurally separate paths, not cases in the switch below:
	// neither decrypting a paid article nor admitting someone to a paid
	// group bears any resemblance to "prompt Claude with some text,"
	// which is the one thing every other job kind here shares. Keeping
	// both fully outside handleJob's shared body means a bug in either
	// still-newer code path can't touch the four already-proven,
	// real-money job kinds' request handling at all.
	if req.Kind == kindJobRequestArticleUnlock {
		handleArticleUnlockJob(ctx, relay, sk, articleKeySk, payment, req)
		return
	}
	if req.Kind == kindJobRequestCommunityJoin {
		handleGroupJoinJob(ctx, relay, sk, communityKeySk, payment, req)
		return
	}
	if req.Kind == kindJobRequestListingPurchase {
		handleListingPurchaseJob(ctx, relay, sk, payment, req)
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

	if req.Kind == kindJobRequestModerate {
		publishModerationLabel(ctx, relay, sk, req, result)
	}
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

	// The article's own price is paid *directly* to its author, not to
	// this DVM's wallet. This DVM fetches a real invoice itself,
	// server-side, straight from the domain in the author's own
	// published lud16 (see lnurl.go) — that HTTPS call is what actually
	// establishes the invoice is genuine, not any property of the
	// invoice string itself. (A first version of this trusted a
	// client-submitted invoice + payment preimage, verified via the
	// invoice's own bolt11 signature; that was proven insecure by a real
	// forged-invoice test — ECDSA signature *recovery* always succeeds
	// for *some* key given any signature+message pair, so it can't
	// detect tampering without already knowing which key to expect.)
	// Settlement is confirmed via LUD-21's verify mechanism, since this
	// DVM has no NWC wallet connection to the author's own wallet to
	// lookup_invoice against. This DVM never holds or forwards the
	// author's money — only NOSTRAS's own flat fee below ever touches
	// its own wallet, preserving the standing rule that this DVM's NWC
	// connection only ever receives, never sends.
	authorProfileEvents, err := relay.QuerySync(ctx, nostr.Filter{Kinds: []int{0}, Authors: []string{article.PubKey}, Limit: 1})
	if err != nil || len(authorProfileEvents) == 0 {
		publishFeedback(ctx, relay, sk, req, "error", "could not find the article author's profile")
		return
	}
	var authorProfile struct {
		Lud16 string `json:"lud16"`
	}
	if err := json.Unmarshal([]byte(authorProfileEvents[0].Content), &authorProfile); err != nil || authorProfile.Lud16 == "" {
		publishFeedback(ctx, relay, sk, req, "error", "the article author has no Lightning address set — cannot pay them")
		return
	}

	lnurlParams, err := fetchLnurlPayParams(ctx, authorProfile.Lud16)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", err.Error())
		return
	}
	priceMsat := priceSats * 1000
	if priceMsat < lnurlParams.MinSendable || priceMsat > lnurlParams.MaxSendable {
		publishFeedback(ctx, relay, sk, req, "error", "the article's price is outside the author's wallet's accepted range")
		return
	}
	authorInvoice, err := fetchLnurlInvoice(ctx, lnurlParams.Callback, priceMsat)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", err.Error())
		return
	}
	if invoiceMsat, err := bolt11Amount(authorInvoice.PR); err != nil || invoiceMsat != priceMsat {
		publishFeedback(ctx, relay, sk, req, "error", "the author's wallet returned an invoice for the wrong amount")
		return
	}

	publishPaymentRequiredFor(ctx, relay, sk, req, priceMsat, authorInvoice.PR, "author")
	if settled, _, _ := pollLnurlVerify(ctx, authorInvoice.Verify); !settled {
		publishFeedback(ctx, relay, sk, req, "error", "author payment not received in time")
		return
	}

	// NOSTRAS's own flat fee for running the unlock/decryption service —
	// same operator wallet and requirePayment mechanism as every other
	// job kind, just a small flat amount instead of the full price now
	// that the price itself goes directly to the author above.
	if payment != nil {
		paid, err := requirePayment(ctx, relay, sk, payment, req, articleAuthorPayoutFeeSats)
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

// isAlreadyGroupMember replays a group's real kind:9007/9000/9001 history
// — the exact same chronological source of truth server/nip29.go's own
// RejectEvent enforcement trusts, and client/src/hooks/useGroupMembership.ts
// independently replays the identical way — so this DVM never disagrees
// with the relay about who already qualifies. Used only to avoid
// charging someone who's already an admin or member; the relay's own
// RejectEvent hook is what actually enforces membership either way, this
// is purely a "don't take someone's money for a no-op" courtesy check.
func isAlreadyGroupMember(ctx context.Context, relay *nostr.Relay, groupID, pubkey string) bool {
	history, err := relay.QuerySync(ctx, nostr.Filter{
		Kinds: []int{nostr.KindSimpleGroupCreateGroup, nostr.KindSimpleGroupPutUser, nostr.KindSimpleGroupRemoveUser},
		Tags:  nostr.TagMap{"h": []string{groupID}},
	})
	if err != nil {
		return false
	}
	sort.Slice(history, func(i, j int) bool { return history[i].CreatedAt < history[j].CreatedAt })
	qualifies := false
	for _, evt := range history {
		switch evt.Kind {
		case nostr.KindSimpleGroupCreateGroup:
			if evt.PubKey == pubkey {
				qualifies = true
			}
		case nostr.KindSimpleGroupPutUser:
			for _, tag := range evt.Tags {
				if len(tag) >= 2 && tag[0] == "p" && tag[1] == pubkey {
					qualifies = true
				}
			}
		case nostr.KindSimpleGroupRemoveUser:
			for _, tag := range evt.Tags {
				if len(tag) >= 2 && tag[0] == "p" && tag[1] == pubkey {
					qualifies = false
				}
			}
		}
	}
	return qualifies
}

// handleGroupJoinJob is Paid Communities' DVM half — server/nip29.go's
// RejectEvent hook is what actually gates posting; this is what gets
// someone onto the "member" side of that gate after paying the group's
// own price. A group opts in by (1) publishing a kind:9002 with
// ["restricted"] (see nip29.go's own comment on why 9002, not 39000, is
// what the relay trusts) and (2) publishing a kind:39000 metadata event
// carrying ["price", sats] and ["payout", lud16] — the display copy
// every client (including this DVM) actually reads pricing from, same
// convention as a paid article's own price tag.
func handleGroupJoinJob(ctx context.Context, relay *nostr.Relay, sk, communityKeySk string, payment *paymentConfig, req *nostr.Event) {
	markJobReceived()

	iTag := req.Tags.Find("i")
	if len(iTag) < 2 || iTag[1] == "" {
		publishFeedback(ctx, relay, sk, req, "error", `missing required i tag naming the group (["i", "<group-id>", "text"])`)
		return
	}
	groupID := iTag[1]

	if isAlreadyGroupMember(ctx, relay, groupID, req.PubKey) {
		publishFeedback(ctx, relay, sk, req, "error", "you're already a member or admin of this group")
		return
	}

	metaEvents, err := relay.QuerySync(ctx, nostr.Filter{Kinds: []int{39000}, Tags: nostr.TagMap{"d": []string{groupID}}, Limit: 5})
	if err != nil || len(metaEvents) == 0 {
		publishFeedback(ctx, relay, sk, req, "error", "could not find that group")
		return
	}
	// A group can in principle have more than one admin each publishing
	// their own metadata copy at a different address (kind:39000 is
	// addressable per (kind, pubkey, d) — see nip29.go's own comment on
	// why the relay's actual enforcement never trusts this event for
	// anything security-relevant). Newest-first is a reasonable,
	// low-stakes default for pricing display specifically: worst case an
	// admin's edit briefly lags a co-admin's, not a security hole.
	meta := metaEvents[0]
	for _, m := range metaEvents {
		if m.CreatedAt > meta.CreatedAt {
			meta = m
		}
	}

	if !hasTag(meta.Tags, "restricted") {
		publishFeedback(ctx, relay, sk, req, "error", "this group doesn't require joining — anyone can already post")
		return
	}
	priceTag := meta.Tags.Find("price")
	payoutTag := meta.Tags.Find("payout")
	if len(priceTag) < 2 || len(payoutTag) < 2 || payoutTag[1] == "" {
		publishFeedback(ctx, relay, sk, req, "error", "this group hasn't set up paid joining")
		return
	}
	priceSats, err := strconv.ParseInt(priceTag[1], 10, 64)
	if err != nil || priceSats <= 0 {
		publishFeedback(ctx, relay, sk, req, "error", "this group has an invalid price")
		return
	}
	payoutLud16 := payoutTag[1]

	// Same real-provenance reasoning as the paid-article author payout:
	// this DVM fetches a real invoice itself, directly from the domain
	// in the group's own published payout address — that HTTPS call is
	// what actually establishes it's genuine, not anything checkable
	// about an invoice string after the fact.
	lnurlParams, err := fetchLnurlPayParams(ctx, payoutLud16)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", err.Error())
		return
	}
	priceMsat := priceSats * 1000
	if priceMsat < lnurlParams.MinSendable || priceMsat > lnurlParams.MaxSendable {
		publishFeedback(ctx, relay, sk, req, "error", "this group's price is outside its payout wallet's accepted range")
		return
	}
	payoutInvoice, err := fetchLnurlInvoice(ctx, lnurlParams.Callback, priceMsat)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", err.Error())
		return
	}
	if invoiceMsat, err := bolt11Amount(payoutInvoice.PR); err != nil || invoiceMsat != priceMsat {
		publishFeedback(ctx, relay, sk, req, "error", "the group's payout wallet returned an invoice for the wrong amount")
		return
	}

	publishPaymentRequiredFor(ctx, relay, sk, req, priceMsat, payoutInvoice.PR, "group")
	if settled, _, _ := pollLnurlVerify(ctx, payoutInvoice.Verify); !settled {
		publishFeedback(ctx, relay, sk, req, "error", "group payment not received in time")
		return
	}

	// NOSTRAS's own flat fee for running the join/admission service —
	// same operator wallet and requirePayment mechanism as every other
	// job kind, a small flat amount separate from the group's own price
	// above.
	if payment != nil {
		paid, err := requirePayment(ctx, relay, sk, payment, req, communityJoinFeeSats)
		if err != nil {
			publishFeedback(ctx, relay, sk, req, "error", err.Error())
			return
		}
		if !paid {
			return
		}
	}

	publishFeedback(ctx, relay, sk, req, "processing", "")

	// The actual unlock: a real kind:9000 admitting the payer as a
	// "member" (not "admin"), signed by the persisted community key.
	// This only succeeds if that key is already an admin of the target
	// group — server/nip29.go's own cache.isAdmin check enforces that
	// unconditionally, the same "blocked: admin only" surface a group
	// owner would see if they forgot to promote it, not a new failure
	// mode built here.
	putUser := nostr.Event{
		Kind:      nostr.KindSimpleGroupPutUser,
		CreatedAt: nostr.Now(),
		Tags: nostr.Tags{
			{"h", groupID},
			{"p", req.PubKey, "member"},
		},
	}
	if err := signAndPublishChecked(ctx, relay, communityKeySk, putUser); err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "payment received, but could not admit you to the group — is the community admin key actually promoted in this group? ("+err.Error()+")")
		return
	}

	result := nostr.Event{
		Kind:      kindJobResultCommunityJoin,
		CreatedAt: nostr.Now(),
		Content:   "joined",
		Tags:      nostr.Tags{{"e", req.ID}, {"p", req.PubKey}, {"h", groupID}},
	}
	signAndPublish(ctx, relay, sk, result)
}

// listingPriceSats converts a NIP-99 listing's ["price", amount, currency,
// frequency?] tag into a real sats amount to invoice. "sats"/"btc" convert
// directly; "usd" converts via the same live BTC/USD rate feed already
// used for dynamic job pricing (fetchBTCUSDRate). Any other currency, or
// a missing/malformed price tag, is a real, stated scope limit for Buy
// Now — not silently mishandled.
func listingPriceSats(ctx context.Context, tags nostr.Tags) (int64, error) {
	priceTag := tags.Find("price")
	if len(priceTag) < 3 {
		return 0, fmt.Errorf("this listing has no price set")
	}
	amount, err := strconv.ParseFloat(priceTag[1], 64)
	if err != nil || amount <= 0 {
		return 0, fmt.Errorf("this listing has an invalid price")
	}
	switch strings.ToLower(priceTag[2]) {
	case "sats", "sat":
		return int64(math.Round(amount)), nil
	case "btc":
		return int64(math.Round(amount * 100_000_000)), nil
	case "usd":
		rate, err := fetchBTCUSDRate(ctx)
		if err != nil {
			return 0, fmt.Errorf("could not look up a live BTC/USD rate to price this listing: %w", err)
		}
		return int64(math.Round(amount / rate * 100_000_000)), nil
	default:
		return 0, fmt.Errorf("this listing is priced in %s, which Buy Now doesn't support yet (sats, btc, and usd only)", priceTag[2])
	}
}

// handleListingPurchaseJob confirms a real "Buy Now" payment for a
// NIP-99 classified listing (kind:30402) and publishes a public,
// independently-verifiable receipt. This DVM structurally cannot mark
// the listing itself "sold" — that event is signed by the seller's own
// key, and unlike Communities there's no persisted "listing-admin" key
// concept to lean on — so the receipt (see publishMarketplaceLabel) is
// the honest ceiling: an attested statement that a real payment
// settled, not a state change to the listing. Marking it sold stays
// the seller's own action, same fetch-then-merge republish every other
// owner-edit in this app already uses.
func handleListingPurchaseJob(ctx context.Context, relay *nostr.Relay, sk string, payment *paymentConfig, req *nostr.Event) {
	markJobReceived()

	// Deliberately not requiring iTag[2] == "event" (unlike
	// handleArticleUnlockJob) — this reuses the client's generic
	// requestDvmJob() helper (lib/dvm.ts), which always sends a plain
	// ["i", value, "text"] tag with no per-call override, same
	// convention handleGroupJoinJob already accepts. The value is still
	// a real event id either way, just not marked "event" — the DVM
	// looks it up by id regardless of the tag's own type marker.
	iTag := req.Tags.Find("i")
	if len(iTag) < 2 || iTag[1] == "" {
		publishFeedback(ctx, relay, sk, req, "error", `missing required i tag naming the listing (["i", "<listing-event-id>"])`)
		return
	}
	listingID := iTag[1]

	found, err := relay.QuerySync(ctx, nostr.Filter{IDs: []string{listingID}, Kinds: []int{kindListing}})
	if err != nil || len(found) == 0 {
		publishFeedback(ctx, relay, sk, req, "error", "could not find that listing")
		return
	}
	listing := found[0]

	if statusTag := listing.Tags.Find("status"); len(statusTag) >= 2 && statusTag[1] == "sold" {
		publishFeedback(ctx, relay, sk, req, "error", "this listing has already been marked sold")
		return
	}

	priceSats, err := listingPriceSats(ctx, listing.Tags)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", err.Error())
		return
	}

	// Same real-provenance reasoning as the paid-article author payout:
	// this DVM fetches a real invoice itself, directly from the domain
	// in the seller's own published lud16 — that HTTPS call is what
	// actually establishes it's genuine, not anything checkable about
	// an invoice string after the fact.
	sellerProfileEvents, err := relay.QuerySync(ctx, nostr.Filter{Kinds: []int{0}, Authors: []string{listing.PubKey}, Limit: 1})
	if err != nil || len(sellerProfileEvents) == 0 {
		publishFeedback(ctx, relay, sk, req, "error", "could not find the seller's profile")
		return
	}
	var sellerProfile struct {
		Lud16 string `json:"lud16"`
	}
	if err := json.Unmarshal([]byte(sellerProfileEvents[0].Content), &sellerProfile); err != nil || sellerProfile.Lud16 == "" {
		publishFeedback(ctx, relay, sk, req, "error", "the seller has no Lightning address set — cannot pay them")
		return
	}

	lnurlParams, err := fetchLnurlPayParams(ctx, sellerProfile.Lud16)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", err.Error())
		return
	}
	priceMsat := priceSats * 1000
	if priceMsat < lnurlParams.MinSendable || priceMsat > lnurlParams.MaxSendable {
		publishFeedback(ctx, relay, sk, req, "error", "this listing's price is outside the seller's wallet's accepted range")
		return
	}
	sellerInvoice, err := fetchLnurlInvoice(ctx, lnurlParams.Callback, priceMsat)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", err.Error())
		return
	}
	if invoiceMsat, err := bolt11Amount(sellerInvoice.PR); err != nil || invoiceMsat != priceMsat {
		publishFeedback(ctx, relay, sk, req, "error", "the seller's wallet returned an invoice for the wrong amount")
		return
	}

	publishPaymentRequiredFor(ctx, relay, sk, req, priceMsat, sellerInvoice.PR, "seller")
	settled, preimage, _ := pollLnurlVerify(ctx, sellerInvoice.Verify)
	if !settled {
		publishFeedback(ctx, relay, sk, req, "error", "seller payment not received in time")
		return
	}

	// NOSTRAS's own flat fee for running the purchase-confirmation
	// service — same operator wallet and requirePayment mechanism as
	// every other job kind, a small flat amount separate from the
	// listing's own price above.
	if payment != nil {
		paid, err := requirePayment(ctx, relay, sk, payment, req, marketplacePurchaseFeeSats)
		if err != nil {
			publishFeedback(ctx, relay, sk, req, "error", err.Error())
			return
		}
		if !paid {
			return
		}
	}

	publishFeedback(ctx, relay, sk, req, "processing", "")

	receiptID, err := publishMarketplaceLabel(ctx, relay, sk, listingID, req.PubKey, priceSats, preimage)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "seller payment received, but the receipt could not be published — please contact support")
		return
	}

	result := nostr.Event{
		Kind:      kindJobResultListingPurchase,
		CreatedAt: nostr.Now(),
		Content:   receiptID,
		Tags:      nostr.Tags{{"e", req.ID}, {"p", req.PubKey}, {"e", listingID, "", "listing"}},
	}
	signAndPublish(ctx, relay, sk, result)
}

// publishMarketplaceLabel publishes a NIP-32 label (kind:1985) attesting
// a listing's Buy Now payment genuinely settled — the DVM's honest
// ceiling, since it cannot sign as the listing's own seller to mark it
// "sold" directly (see handleListingPurchaseJob above). Mirrors
// publishModerationLabel's L/l namespace-tag shape with a different
// namespace/value. Signs and publishes directly here, not via
// signAndPublish/signAndPublishChecked (which take the event by value,
// so the ID they compute internally never reaches the caller) — the
// caller needs the real event id back to link the buyer straight to
// the receipt.
//
// Includes the real Lightning payment preimage from the seller's own
// LUD-21 verify response, as a "preimage" tag — added 2026-08-21, in
// direct response to a real public question asking exactly what this
// receipt proves. Before this, the preimage was fetched from the
// verify endpoint and then silently discarded, so the receipt was only
// ever "the DVM independently checked with the seller's own service and
// it said yes" — a real, honest limitation, not something to overstate:
// this still doesn't make the receipt *self-verifying* by a third party
// without also being able to check the preimage against the invoice's
// own payment_hash, which this DVM doesn't currently decode from the
// bolt11 string — but it's real cryptographic evidence tied to this
// specific payment now, not just an attestation.
func publishMarketplaceLabel(ctx context.Context, relay *nostr.Relay, sk, listingID, buyerPubkey string, amountSats int64, preimage string) (string, error) {
	evt := nostr.Event{
		Kind:    kindLabel,
		Content: fmt.Sprintf("Payment of %d sats confirmed for this listing from %s at %s.", amountSats, buyerPubkey, time.Now().UTC().Format(time.RFC3339)),
		Tags: nostr.Tags{
			{"L", marketplaceLabelNamespace},
			{"l", "purchased", marketplaceLabelNamespace},
			{"e", listingID},
			{"p", buyerPubkey},
			{"preimage", preimage},
		},
		CreatedAt: nostr.Now(),
	}
	if err := evt.Sign(sk); err != nil {
		return "", fmt.Errorf("sign error: %w", err)
	}
	if err := relay.Publish(ctx, evt); err != nil {
		return "", fmt.Errorf("publish error: %w", err)
	}
	return evt.ID, nil
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

// dvmAboutAndTags builds the shared "about" text and kind:31990 job-kind
// tags — factored out so publishDvmProfile's real kind:0 event can reuse
// the exact same about text as the handler announcement, rather than a
// second, driftable copy.
func dvmAboutAndTags(articleKeyPk, communityKeyPk string) (string, nostr.Tags) {
	about := fmt.Sprintf("Claude-powered NIP-90 jobs: summarize (5001), translate (5002), free-form ask (5050), spam/scam classification (5501). Priced per job from real token cost — typically a few dozen sats — and you only pay if the job completes. Marketplace purchase confirmation (5907) — pay a NIP-99 listing's own seller directly via their real Lightning address, and get back a public, independently-verifiable NIP-32 receipt; NOSTRAS keeps a flat %d-sat fee for the confirmation service.", marketplacePurchaseFeeSats)
	tags := nostr.Tags{
		{"d", dvmHandlerDTag},
		{"k", strconv.Itoa(kindJobRequestSummarize)},
		{"k", strconv.Itoa(kindJobRequestTranslate)},
		{"k", strconv.Itoa(kindJobRequestGenerate)},
		{"k", strconv.Itoa(kindJobRequestModerate)},
		{"k", strconv.Itoa(kindJobRequestListingPurchase)},
	}
	if articleKeyPk != "" {
		about += fmt.Sprintf(" Paid long-form article unlock (5904) — the author sets the price and is paid directly via a real zap on the article; NOSTRAS keeps a flat %d-sat fee for the unlock service. Decrypted content is NIP-44-encrypted back to you specifically, not published in the clear.", articleAuthorPayoutFeeSats)
		tags = append(tags, nostr.Tag{"k", strconv.Itoa(kindJobRequestArticleUnlock)})
	}
	if communityKeyPk != "" {
		about += fmt.Sprintf(" Paid community joining (5906) — the group sets its own price and payout address, paid directly; NOSTRAS keeps a flat %d-sat fee for the admission service.", communityJoinFeeSats)
		tags = append(tags, nostr.Tag{"k", strconv.Itoa(kindJobRequestCommunityJoin)})
	}
	return about, tags
}

// publishHandlerAnnouncement advertises this DVM per NIP-89/NIP-90's
// service-provider-discoverability appendix: a single kind:31990 event
// listing every job kind this DVM handles, so a generic NIP-90-aware
// client or marketplace can find and pay it directly. Content is static
// (kind:0-style JSON), deliberately not a live price — the actual price
// is dynamic per job (see estimateJobCostSats), so the description gives
// a representative price band instead of a number that would go stale.
func publishHandlerAnnouncement(ctx context.Context, relay *nostr.Relay, sk, articleKeyPk, communityKeyPk string) nostr.Event {
	about, tags := dvmAboutAndTags(articleKeyPk, communityKeyPk)

	// articleEncryptionPubkey/communityAdminPubkey, each present only
	// when its own feature is enabled, are *separate* fields from this
	// event's own signing pubkey (evt.PubKey, set by signAndPublish
	// below) — that pubkey is stable across restarts too now when
	// NOSTRAS_DVM_IDENTITY_KEY is set (see main()'s own comment), but
	// these two stay their own dedicated persisted keys regardless:
	// articleEncryptionPubkey for authors to encrypt articles against
	// long-term, communityAdminPubkey so a group owner knows which exact
	// pubkey to promote to admin for paid joining to keep working across
	// DVM restarts — kept separate so a bug in either feature's own key
	// handling can't touch the DVM's core identity.
	content, err := json.Marshal(struct {
		Name                    string `json:"name"`
		About                   string `json:"about"`
		Picture                 string `json:"picture"`
		Website                 string `json:"website"`
		ArticleEncryptionPubkey string `json:"articleEncryptionPubkey,omitempty"`
		CommunityAdminPubkey    string `json:"communityAdminPubkey,omitempty"`
	}{
		Name:                    "NOSTRAS DVM",
		About:                   about,
		Picture:                 "https://app.nostras.app/pwa-512x512.png",
		Website:                 "https://nostras.app",
		ArticleEncryptionPubkey: articleKeyPk,
		CommunityAdminPubkey:    communityKeyPk,
	})
	if err != nil {
		fmt.Println("handler announcement marshal error:", err)
		return nostr.Event{}
	}

	evt := nostr.Event{
		Kind:      kindHandlerAnnouncement,
		CreatedAt: nostr.Now(),
		Content:   string(content),
		Tags:      tags,
	}
	return signForBroadcast(ctx, relay, sk, evt)
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
func publishClientHandlerAnnouncement(ctx context.Context, relay *nostr.Relay, sk string) nostr.Event {
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
		return nostr.Event{}
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
	return signForBroadcast(ctx, relay, sk, evt)
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

// publishPaymentRequiredFor is publishPaymentRequired plus a "payee"
// tag, used only for the article-unlock job's author-payment leg, so
// the client can tell it apart from NOSTRAS's own fee (published via
// the plain publishPaymentRequired above, no payee tag) when a single
// job produces two sequential payment-required feedback events.
func publishPaymentRequiredFor(ctx context.Context, relay *nostr.Relay, sk string, req *nostr.Event, amountMsat int64, bolt11, payee string) {
	evt := nostr.Event{
		Kind:      kindJobFeedback,
		CreatedAt: nostr.Now(),
		Content:   "",
		Tags: nostr.Tags{
			{"status", "payment-required"},
			{"amount", strconv.FormatInt(amountMsat, 10), bolt11},
			{"payee", payee},
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

type moderateVerdict struct {
	Verdict    string `json:"verdict"`
	Confidence string `json:"confidence"`
}

// publishModerationLabel turns a spam/scam classification result into a
// real, standard NIP-32 label (kind 1985), separate from the kind:6501
// job result. The classification job itself only ever sees raw text —
// never the original event id (see requestDvmJob's own comment on why:
// most feed notes never touched the local relay this DVM queries
// against) — so the requester must tell us which real event was
// actually classified via a ["param","event_id",<id>] tag if it wants a
// real label published; missing or malformed input here just means no
// label gets published, not an error — the kind:6501 result itself is
// unaffected either way.
func publishModerationLabel(ctx context.Context, relay *nostr.Relay, sk string, req *nostr.Event, result string) {
	eventID := ""
	for _, t := range req.Tags {
		if len(t) >= 3 && t[0] == "param" && t[1] == "event_id" {
			eventID = t[2]
			break
		}
	}
	if len(eventID) != 64 {
		return
	}

	lines := strings.SplitN(result, "\n", 2)
	var v moderateVerdict
	if err := json.Unmarshal([]byte(strings.TrimSpace(lines[0])), &v); err != nil {
		return
	}
	if v.Verdict != "spam" && v.Verdict != "scam" && v.Verdict != "legit" {
		return
	}

	reason := ""
	if len(lines) > 1 {
		reason = strings.TrimSpace(lines[1])
	}

	evt := nostr.Event{
		Kind:      kindLabel,
		CreatedAt: nostr.Now(),
		Content:   reason,
		Tags: nostr.Tags{
			{"L", moderationLabelNamespace},
			{"l", v.Verdict, moderationLabelNamespace},
			{"e", eventID},
		},
	}
	signAndPublish(ctx, relay, sk, evt)
}

func signAndPublish(ctx context.Context, relay *nostr.Relay, sk string, evt nostr.Event) {
	if err := signAndPublishChecked(ctx, relay, sk, evt); err != nil {
		fmt.Println(err)
	}
}

// dvmDiscoveryRelayURLs — where a real NIP-90-aware client, marketplace, or
// directory tool would actually go looking for a DVM's kind:0 and kind:31990,
// not just our own relay. Real, verified gap (2026-09-16): an external
// researcher's reproducible scan found genuinely zero events of any kind for
// this DVM's pubkey across 20 relays, including purplepag.es and
// relay.nostrdvm.com — not because there was no activity, but because
// publishHandlerAnnouncement never published anywhere but our own relay.
// purplepag.es is the standard kind:0 profile-discovery relay generic
// clients already query; relay.nostrdvm.com is DVM-specific discovery.
var dvmDiscoveryRelayURLs = []string{"wss://purplepag.es", "wss://relay.nostrdvm.com"}

// signForBroadcast signs an identity event (the DVM's kind:0 profile, its
// kind:31990 handler announcements) and publishes it to the primary relay,
// same as signAndPublish — but also returns the now-signed event so the
// caller can batch it into one publishToDiscoveryRelays call alongside the
// DVM's other identity events, instead of each announcement dialing the
// same discovery relays separately.
//
// Real, live-caught reason this matters, not theoretical (2026-09-16): the
// first version had each of the three identity-event publishers dial
// dvmDiscoveryRelayURLs independently, each with its own up-to-8s-per-relay
// timeout — three publishers times two discovery relays meant up to six
// sequential dials on every single boot (and every reconnect, since this
// runs inside the retry loop), and a real local test run hit "context
// deadline exceeded" on a later publish purely from that accumulated
// dialing time, not from any actual failure. Connecting once per discovery
// relay and publishing all three events through that one connection cuts
// the real dial count from six to two.
func signForBroadcast(ctx context.Context, relay *nostr.Relay, sk string, evt nostr.Event) nostr.Event {
	if err := evt.Sign(sk); err != nil {
		fmt.Println("sign error:", err)
		return evt
	}
	if err := relay.Publish(ctx, evt); err != nil {
		fmt.Println("publish error:", err)
	}
	return evt
}

// publishToDiscoveryRelays dials each of dvmDiscoveryRelayURLs exactly
// once and publishes every already-signed event in evts through that one
// connection — not once per event (see signForBroadcast's own comment for
// the real boot-time cost that shape had). One slow or unreachable
// discovery relay never blocks another, and never blocks the primary
// relay's own publishes, which already happened before this runs.
// Failures are logged, not fatal — a discovery relay being briefly down,
// or (confirmed live, 2026-09-16: purplepag.es structurally rejects
// kind:31990 — it's a kind:0-only metadata relay) refusing a kind it
// doesn't accept, shouldn't stop the DVM from booting.
func publishToDiscoveryRelays(ctx context.Context, evts []nostr.Event) {
	for _, url := range dvmDiscoveryRelayURLs {
		func() {
			dctx, cancel := context.WithTimeout(ctx, 8*time.Second)
			defer cancel()
			dr, err := nostr.RelayConnect(dctx, url)
			if err != nil {
				fmt.Printf("discovery relay %s: connect error: %v\n", url, err)
				return
			}
			defer dr.Close()
			for _, evt := range evts {
				if err := dr.Publish(dctx, evt); err != nil {
					fmt.Printf("discovery relay %s: publish error (kind %d): %v\n", url, evt.Kind, err)
				}
			}
		}()
	}
}

// publishDvmProfile gives the DVM a genuine kind:0 profile event — the
// kind:31990 handler announcement's own content is kind:0-*shaped* JSON,
// but was never an actual kind:0 event, so any tool that specifically
// resolves kind:0 to answer "who is this pubkey" (purplepag.es chief among
// them) found nothing for this DVM. Same identity, name, about text, and
// broad discovery-relay fanout as the handler announcement — this is purely
// additive, not a replacement for it.
func publishDvmProfile(ctx context.Context, relay *nostr.Relay, sk, about string) nostr.Event {
	content, err := json.Marshal(struct {
		Name    string `json:"name"`
		About   string `json:"about"`
		Picture string `json:"picture"`
		Website string `json:"website"`
	}{
		Name:    "NOSTRAS DVM",
		About:   about,
		Picture: "https://app.nostras.app/pwa-512x512.png",
		Website: "https://nostras.app",
	})
	if err != nil {
		fmt.Println("dvm profile marshal error:", err)
		return nostr.Event{}
	}
	evt := nostr.Event{
		Kind:      0,
		CreatedAt: nostr.Now(),
		Content:   string(content),
	}
	return signForBroadcast(ctx, relay, sk, evt)
}

// signAndPublishChecked is the same sign-then-publish as signAndPublish,
// but returns the failure instead of just logging it — used by
// handleGroupJoinJob specifically, since a rejected kind:9000 (e.g. the
// community key was never actually promoted in that group) needs to
// reach the paying requester as a real error, not be silently swallowed
// after they've already paid.
func signAndPublishChecked(ctx context.Context, relay *nostr.Relay, sk string, evt nostr.Event) error {
	if err := evt.Sign(sk); err != nil {
		return fmt.Errorf("sign error: %w", err)
	}
	if err := relay.Publish(ctx, evt); err != nil {
		return fmt.Errorf("publish error: %w", err)
	}
	return nil
}

// loadEnvFile does a minimal KEY=VALUE .env parse, only filling in variables
// not already set in the environment. Missing file is not an error — the
// caller falls back to a real env var if .nostras.env isn't present.
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
