package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nbd-wtf/go-nostr"
)

func setOpenAIEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for _, k := range []string{
		"NOSTRAS_LLM_BACKEND", "NOSTRAS_LLM_BASE_URL", "NOSTRAS_LLM_MODEL", "NOSTRAS_LLM_API_KEY",
		"NOSTRAS_LLM_PRIVACY", "NOSTRAS_LLM_MAX_TOKENS", "NOSTRAS_LLM_TIMEOUT_SECONDS",
		"NOSTRAS_LLM_INPUT_USD_PER_M", "NOSTRAS_LLM_OUTPUT_USD_PER_M", "NOSTRAS_LLM_REASONING_EFFORT",
	} {
		t.Setenv(k, "")
	}
	t.Setenv("NOSTRAS_LLM_BACKEND", "openai")
	for k, v := range kv {
		t.Setenv(k, v)
	}
}

func TestOpenAIBackendComplete(t *testing.T) {
	var got openAIRequest
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		auth = r.Header.Get("Authorization")
		json.NewDecoder(r.Body).Decode(&got)
		w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"  hello there  "}}]}`))
	}))
	defer srv.Close()

	setOpenAIEnv(t, map[string]string{
		"NOSTRAS_LLM_BASE_URL":         srv.URL + "/v1/",
		"NOSTRAS_LLM_MODEL":            "gemma4",
		"NOSTRAS_LLM_API_KEY":          "secret-token",
		"NOSTRAS_LLM_MAX_TOKENS":       "300",
		"NOSTRAS_LLM_REASONING_EFFORT": "none",
	})
	llm, err := loadLLMBackend()
	if err != nil {
		t.Fatal(err)
	}
	if llm.Name() != "openai" || llm.Model() != "gemma4" || llm.Privacy() != privacyLocal {
		t.Fatalf("unexpected backend: %s %s %s", llm.Name(), llm.Model(), llm.Privacy())
	}

	out, err := llm.Complete(context.Background(), "be brief", "say hi")
	if err != nil {
		t.Fatal(err)
	}
	if out != "hello there" {
		t.Fatalf("got %q", out)
	}
	if auth != "Bearer secret-token" {
		t.Fatalf("auth header %q", auth)
	}
	if got.Model != "gemma4" || got.MaxTokens != 300 || got.ReasoningEffort != "none" || got.Stream || len(got.Messages) != 2 ||
		got.Messages[0].Role != "system" || got.Messages[0].Content != "be brief" ||
		got.Messages[1].Role != "user" || got.Messages[1].Content != "say hi" {
		t.Fatalf("unexpected request: %+v", got)
	}
}

func TestOpenAIBackendErrors(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"server error with message", 500, `{"error":{"message":"model not found"}}`, "model not found"},
		{"server error without json", 502, `bad gateway`, "status 502"},
		{"no choices", 200, `{"choices":[]}`, "no choices"},
		{"empty content", 200, `{"choices":[{"message":{"content":"  "}}]}`, "empty completion"},
		{"only reasoning", 200, `{"choices":[{"message":{"content":"","reasoning":"thinking..."}}]}`, "REASONING_EFFORT"},
		{"malformed json", 200, `not json`, "malformed"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(c.status)
				w.Write([]byte(c.body))
			}))
			defer srv.Close()
			setOpenAIEnv(t, map[string]string{"NOSTRAS_LLM_BASE_URL": srv.URL, "NOSTRAS_LLM_MODEL": "m"})
			llm, err := loadLLMBackend()
			if err != nil {
				t.Fatal(err)
			}
			_, err = llm.Complete(context.Background(), "s", "u")
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("want error containing %q, got %v", c.want, err)
			}
		})
	}
}

func TestOpenAIBackendNoKeyNoAuthHeader(t *testing.T) {
	sawAuth := "unset"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization")
		w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer srv.Close()
	setOpenAIEnv(t, map[string]string{"NOSTRAS_LLM_BASE_URL": srv.URL, "NOSTRAS_LLM_MODEL": "m"})
	llm, _ := loadLLMBackend()
	if _, err := llm.Complete(context.Background(), "s", "u"); err != nil {
		t.Fatal(err)
	}
	if sawAuth != "" {
		t.Fatalf("expected no Authorization header, got %q", sawAuth)
	}
}

func TestLoadLLMBackendConfig(t *testing.T) {
	bad := []map[string]string{
		{"NOSTRAS_LLM_MODEL": "m"},                            // no base URL
		{"NOSTRAS_LLM_BASE_URL": "http://localhost:11434/v1"}, // no model
		{"NOSTRAS_LLM_BASE_URL": "ftp://x/v1", "NOSTRAS_LLM_MODEL": "m"},
		{"NOSTRAS_LLM_BASE_URL": "http://localhost/v1", "NOSTRAS_LLM_MODEL": "m", "NOSTRAS_LLM_PRIVACY": "secret"},
		{"NOSTRAS_LLM_BASE_URL": "http://localhost/v1", "NOSTRAS_LLM_MODEL": "m", "NOSTRAS_LLM_MAX_TOKENS": "-1"},
		{"NOSTRAS_LLM_BASE_URL": "http://localhost/v1", "NOSTRAS_LLM_MODEL": "m", "NOSTRAS_LLM_INPUT_USD_PER_M": "cheap"},
	}
	for i, kv := range bad {
		setOpenAIEnv(t, kv)
		if _, err := loadLLMBackend(); err == nil {
			t.Fatalf("case %d: expected config error for %v", i, kv)
		}
	}

	t.Setenv("NOSTRAS_LLM_BACKEND", "mystery")
	if _, err := loadLLMBackend(); err == nil {
		t.Fatal("expected error for unknown backend")
	}

	t.Setenv("NOSTRAS_LLM_BACKEND", "anthropic")
	t.Setenv("NOSTRAS_ANTHROPIC_API_KEY", "")
	if _, err := loadLLMBackend(); err == nil {
		t.Fatal("expected error for anthropic without API key")
	}
}

func TestDefaultPrivacyFor(t *testing.T) {
	cases := map[string]string{
		"localhost":                    privacyLocal,
		"127.0.0.1":                    privacyLocal,
		"192.168.1.20":                 privacyLocal,
		"10.0.0.5":                     privacyLocal,
		"gpu.process.nostras.internal": privacyLocal,
		"api.example.com":              privacyThirdParty,
		"8.8.8.8":                      privacyThirdParty,
	}
	for host, want := range cases {
		if got := defaultPrivacyFor(host); got != want {
			t.Errorf("%s: got %s, want %s", host, got, want)
		}
	}
}

func TestOpenAIPricing(t *testing.T) {
	setOpenAIEnv(t, map[string]string{"NOSTRAS_LLM_BASE_URL": "http://localhost/v1", "NOSTRAS_LLM_MODEL": "m"})
	llm, _ := loadLLMBackend()
	if _, _, ok := llm.PricePerMillionUSD(); ok {
		t.Fatal("no prices configured should mean flat pricing")
	}
	// Flat pricing returns the fallback without any network call.
	if got := estimateJobCostSats(context.Background(), llm, "s", "u", 42); got != 42 {
		t.Fatalf("flat price: got %d", got)
	}
	n, _ := llm.InputTokens(context.Background(), "abcd", "efgh")
	if n != 2 {
		t.Fatalf("token estimate: got %d", n)
	}

	setOpenAIEnv(t, map[string]string{
		"NOSTRAS_LLM_BASE_URL": "http://localhost/v1", "NOSTRAS_LLM_MODEL": "m",
		"NOSTRAS_LLM_INPUT_USD_PER_M": "0.5", "NOSTRAS_LLM_OUTPUT_USD_PER_M": "1.5",
	})
	llm, _ = loadLLMBackend()
	if in, out, ok := llm.PricePerMillionUSD(); !ok || in != 0.5 || out != 1.5 {
		t.Fatalf("prices: %v %v %v", in, out, ok)
	}
}

func TestLLMRegistry(t *testing.T) {
	setOpenAIEnv(t, map[string]string{"NOSTRAS_LLM_BASE_URL": "https://api.example.com/v1", "NOSTRAS_LLM_MODEL": "big"})
	t.Setenv("MAPLE_KEY", "k123")
	t.Setenv("NOSTRAS_LLM_EXTRA_BACKENDS", `[
		{"base_url":"http://localhost:11434/v1","model":"gemma4:latest","reasoning_effort":"none"},
		{"base_url":"https://maple.example/v1","model":"llama-enclave","privacy":"confidential","api_key_env":"MAPLE_KEY"}
	]`)
	reg, err := loadLLMRegistry()
	if err != nil {
		t.Fatal(err)
	}
	got := reg.Advertised()
	if len(got) != 3 || got[0].ID != "big" || !got[0].Default || got[0].Privacy != privacyThirdParty ||
		got[1].ID != "gemma4:latest" || got[1].Privacy != privacyLocal || got[1].Default ||
		got[2].Privacy != privacyConfidential {
		t.Fatalf("unexpected models: %+v", got)
	}
	if b, ok := reg.Get("llama-enclave"); !ok || b.(*openAIBackend).apiKey != "k123" {
		t.Fatal("extra backend key not loaded from api_key_env")
	}
	if _, ok := reg.Get("nope"); ok {
		t.Fatal("unknown model should not resolve")
	}
	if reg.Default().Model() != "big" {
		t.Fatal("wrong default")
	}
	want := "big (third-party API, default), gemma4:latest (runs locally) and llama-enclave (confidential compute)"
	if s := modelsSummary(reg); s != want {
		t.Fatalf("summary:\n got %q\nwant %q", s, want)
	}

	bad := []string{
		`not json`,
		`[{"base_url":"http://localhost/v1","model":"big"}]`,                           // duplicate of default
		`[{"base_url":"http://localhost/v1","model":"x","api_key_env":"UNSET_VAR_1"}]`, // key var empty
		`[{"base_url":"http://localhost/v1"}]`,                                         // no model
		`[{"base_url":"http://localhost/v1","model":"x","privacy":"magic"}]`,
	}
	for _, b := range bad {
		t.Setenv("NOSTRAS_LLM_EXTRA_BACKENDS", b)
		if _, err := loadLLMRegistry(); err == nil {
			t.Fatalf("expected error for %s", b)
		}
	}
}

func TestParamValue(t *testing.T) {
	tags := nostr.Tags{{"i", "x", "text"}, {"param", "model", "gemma4"}, {"param", "language", "es"}, {"param", "short"}}
	if v, ok := paramValue(tags, "language"); !ok || v != "es" {
		t.Fatalf("language: %q %v", v, ok)
	}
	if v, ok := paramValue(tags, "model"); !ok || v != "gemma4" {
		t.Fatalf("model: %q %v", v, ok)
	}
	if _, ok := paramValue(tags, "short"); ok {
		t.Fatal("2-element param tag should not match")
	}
}
