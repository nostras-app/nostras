package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"
)

// llmBackend is the model behind the DVM's text jobs (summarize,
// translate, ask, spam check). Every one of those jobs is just a system
// prompt plus the user's text, so this interface is all they need.
//
// Selected by NOSTRAS_LLM_BACKEND:
//
//	anthropic (default)  Claude via the Anthropic API. Needs
//	                     NOSTRAS_ANTHROPIC_API_KEY.
//	openai               Any OpenAI-compatible /chat/completions endpoint:
//	                     Ollama, llama.cpp, vLLM, LM Studio, or a hosted
//	                     confidential-compute proxy. Needs
//	                     NOSTRAS_LLM_BASE_URL and NOSTRAS_LLM_MODEL.
type llmBackend interface {
	// Name is the backend id ("anthropic" or "openai").
	Name() string
	// Model is the model name sent with each request.
	Model() string
	// Privacy says who can see the job text once the DVM forwards it:
	// "local" (inference on the operator's own hardware), "confidential"
	// (a hosted service that can't read prompts, e.g. GPU enclaves), or
	// "third-party" (a hosted API that can).
	Privacy() string
	// Complete runs one system-prompt + user-text completion.
	Complete(ctx context.Context, systemPrompt, userText string) (string, error)
	// InputTokens counts (or estimates) the prompt's input tokens, used
	// for per-job pricing.
	InputTokens(ctx context.Context, systemPrompt, userText string) (int64, error)
	// PricePerMillionUSD is the input/output token price used to price
	// jobs. ok=false means "charge the flat NOSTRAS_DVM_PRICE_SATS".
	PricePerMillionUSD() (input, output float64, ok bool)
}

const (
	privacyLocal        = "local"
	privacyConfidential = "confidential"
	privacyThirdParty   = "third-party"

	defaultOpenAITimeout = 5 * time.Minute
)

// loadLLMBackend builds the backend from the environment. An error means
// the configuration is unusable and the DVM shouldn't start.
func loadLLMBackend() (llmBackend, error) {
	switch b := strings.ToLower(strings.TrimSpace(os.Getenv("NOSTRAS_LLM_BACKEND"))); b {
	case "", "anthropic":
		apiKey := os.Getenv("NOSTRAS_ANTHROPIC_API_KEY")
		if apiKey == "" {
			return nil, fmt.Errorf("NOSTRAS_ANTHROPIC_API_KEY not set (checked environment and ../.nostras.env)")
		}
		return &anthropicBackend{client: anthropic.NewClient(option.WithAPIKey(apiKey))}, nil
	case "openai":
		return loadOpenAIBackend()
	default:
		return nil, fmt.Errorf("unknown NOSTRAS_LLM_BACKEND %q (use anthropic or openai)", b)
	}
}

// estimateJobCostSats prices a job proportionally to its expected model
// cost: input tokens (counted or estimated by the backend) plus a typical
// output length, at the backend's per-token price, converted to sats at
// the live BTC/USD rate. Falls back to the flat price when the backend
// has no per-token price or any lookup fails.
func estimateJobCostSats(ctx context.Context, llm llmBackend, systemPrompt, userText string, fallbackSats int64) int64 {
	inPrice, outPrice, ok := llm.PricePerMillionUSD()
	if !ok {
		return fallbackSats
	}

	inputTokens, err := llm.InputTokens(ctx, systemPrompt, userText)
	if err != nil {
		fmt.Println("token count failed, falling back to flat price:", err)
		return fallbackSats
	}

	usd := float64(inputTokens)/1_000_000*inPrice +
		float64(estimatedOutputTokens)/1_000_000*outPrice

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

// --- Anthropic -------------------------------------------------------------

type anthropicBackend struct {
	client anthropic.Client
}

func (b *anthropicBackend) Name() string    { return "anthropic" }
func (b *anthropicBackend) Model() string   { return dvmModel }
func (b *anthropicBackend) Privacy() string { return privacyThirdParty }

func (b *anthropicBackend) PricePerMillionUSD() (float64, float64, bool) {
	return inputPricePerMillionUSD, outputPricePerMillionUSD, true
}

func (b *anthropicBackend) InputTokens(ctx context.Context, systemPrompt, userText string) (int64, error) {
	count, err := b.client.Messages.CountTokens(ctx, anthropic.MessageCountTokensParams{
		Model:  dvmModel,
		System: anthropic.MessageCountTokensParamsSystemUnion{OfString: param.NewOpt(systemPrompt)},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(userText)),
		},
	})
	if err != nil {
		return 0, err
	}
	return count.InputTokens, nil
}

func (b *anthropicBackend) Complete(ctx context.Context, systemPrompt, userText string) (string, error) {
	resp, err := b.client.Messages.New(ctx, anthropic.MessageNewParams{
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

// --- OpenAI-compatible -----------------------------------------------------

// openAIBackend talks to any server implementing OpenAI's
// POST /chat/completions. Plain net/http, no SDK: the request and
// response shapes used here are tiny and stable across implementations.
type openAIBackend struct {
	baseURL   string // e.g. http://localhost:11434/v1 (no trailing slash)
	model     string
	apiKey    string // optional; local servers usually don't need one
	privacy   string
	maxTokens int
	// reasoningEffort is sent as reasoning_effort when set. "none" turns
	// off hidden reasoning on thinking models (e.g. gemma4, qwen3 under
	// Ollama), which otherwise can spend the whole max_tokens budget
	// thinking and return empty content.
	reasoningEffort string
	inPrice         float64 // USD per million tokens; 0 with outPrice 0 = flat price
	outPrice        float64
	http            *http.Client
}

func loadOpenAIBackend() (*openAIBackend, error) {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("NOSTRAS_LLM_BASE_URL")), "/")
	model := strings.TrimSpace(os.Getenv("NOSTRAS_LLM_MODEL"))
	if base == "" || model == "" {
		return nil, fmt.Errorf("NOSTRAS_LLM_BACKEND=openai needs NOSTRAS_LLM_BASE_URL and NOSTRAS_LLM_MODEL")
	}
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("NOSTRAS_LLM_BASE_URL must be an http(s) URL, got %q", base)
	}

	privacy := strings.ToLower(strings.TrimSpace(os.Getenv("NOSTRAS_LLM_PRIVACY")))
	switch privacy {
	case "":
		privacy = defaultPrivacyFor(u.Hostname())
	case privacyLocal, privacyConfidential, privacyThirdParty:
	default:
		return nil, fmt.Errorf("NOSTRAS_LLM_PRIVACY must be local, confidential or third-party, got %q", privacy)
	}

	maxTokens := dvmMaxTokens
	if v := os.Getenv("NOSTRAS_LLM_MAX_TOKENS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return nil, fmt.Errorf("NOSTRAS_LLM_MAX_TOKENS must be a positive integer, got %q", v)
		}
		maxTokens = n
	}

	timeout := defaultOpenAITimeout
	if v := os.Getenv("NOSTRAS_LLM_TIMEOUT_SECONDS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return nil, fmt.Errorf("NOSTRAS_LLM_TIMEOUT_SECONDS must be a positive integer, got %q", v)
		}
		timeout = time.Duration(n) * time.Second
	}

	inPrice, err := optionalPrice("NOSTRAS_LLM_INPUT_USD_PER_M")
	if err != nil {
		return nil, err
	}
	outPrice, err := optionalPrice("NOSTRAS_LLM_OUTPUT_USD_PER_M")
	if err != nil {
		return nil, err
	}

	return &openAIBackend{
		baseURL:         base,
		model:           model,
		apiKey:          os.Getenv("NOSTRAS_LLM_API_KEY"),
		privacy:         privacy,
		maxTokens:       maxTokens,
		reasoningEffort: strings.TrimSpace(os.Getenv("NOSTRAS_LLM_REASONING_EFFORT")),
		inPrice:         inPrice,
		outPrice:        outPrice,
		http:            &http.Client{Timeout: timeout},
	}, nil
}

func optionalPrice(name string) (float64, error) {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return 0, nil
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || f < 0 {
		return 0, fmt.Errorf("%s must be a non-negative number, got %q", name, v)
	}
	return f, nil
}

// defaultPrivacyFor guesses the privacy level when the operator didn't
// declare one: a loopback or private-network host is inference on the
// operator's own hardware; anything else is assumed to be a hosted API
// that can read prompts. "confidential" is never assumed: it has to be
// declared, since nothing about a URL proves it.
func defaultPrivacyFor(host string) string {
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".internal") {
		return privacyLocal
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		return privacyLocal
	}
	return privacyThirdParty
}

func (b *openAIBackend) Name() string    { return "openai" }
func (b *openAIBackend) Model() string   { return b.model }
func (b *openAIBackend) Privacy() string { return b.privacy }

func (b *openAIBackend) PricePerMillionUSD() (float64, float64, bool) {
	if b.inPrice == 0 && b.outPrice == 0 {
		return 0, 0, false
	}
	return b.inPrice, b.outPrice, true
}

// InputTokens estimates rather than counts: there's no portable
// token-count endpoint across OpenAI-compatible servers. About four
// characters per token is the usual rule of thumb for English; it's only
// used for pricing, and only when a per-token price is configured.
func (b *openAIBackend) InputTokens(_ context.Context, systemPrompt, userText string) (int64, error) {
	chars := utf8.RuneCountInString(systemPrompt) + utf8.RuneCountInString(userText)
	return int64(math.Ceil(float64(chars) / 4)), nil
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIRequest struct {
	Model           string          `json:"model"`
	Messages        []openAIMessage `json:"messages"`
	MaxTokens       int             `json:"max_tokens"`
	Stream          bool            `json:"stream"`
	ReasoningEffort string          `json:"reasoning_effort,omitempty"`
}

type openAIResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
			// Thinking models' hidden reasoning; servers differ on the
			// field name. Only used to explain an empty answer.
			Reasoning        string `json:"reasoning"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (b *openAIBackend) Complete(ctx context.Context, systemPrompt, userText string) (string, error) {
	body, err := json.Marshal(openAIRequest{
		Model: b.model,
		Messages: []openAIMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userText},
		},
		MaxTokens:       b.maxTokens,
		Stream:          false,
		ReasoningEffort: b.reasoningEffort,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if b.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+b.apiKey)
	}

	resp, err := b.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("model request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", fmt.Errorf("reading model response: %w", err)
	}

	var parsed openAIResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("model server returned status %d", resp.StatusCode)
		}
		return "", fmt.Errorf("model server returned malformed JSON")
	}
	if resp.StatusCode != http.StatusOK {
		if parsed.Error != nil && parsed.Error.Message != "" {
			return "", fmt.Errorf("model server returned status %d: %s", resp.StatusCode, parsed.Error.Message)
		}
		return "", fmt.Errorf("model server returned status %d", resp.StatusCode)
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("no choices in model response")
	}
	msg := parsed.Choices[0].Message
	text := strings.TrimSpace(msg.Content)
	if text == "" {
		if msg.Reasoning != "" || msg.ReasoningContent != "" {
			return "", fmt.Errorf("model used its whole token budget on reasoning; set NOSTRAS_LLM_REASONING_EFFORT=none or raise NOSTRAS_LLM_MAX_TOKENS")
		}
		return "", fmt.Errorf("empty completion from model")
	}
	return text, nil
}
