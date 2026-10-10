# Running the NOSTRAS DVM on your own AI models

The NOSTRAS DVM (`server/cmd/dvm`) answers four NIP-90 AI jobs:
summarize (5001), translate (5002), free-form ask (5050) and spam/scam
check (5501). By default it uses Claude through the Anthropic API. This
guide shows how to run those jobs on models you host yourself, so no AI
company ever sees your users' text, and how to offer several models at
once.

## What stays private, and from whom

There are two separate questions.

**Who can read a job on the relay?** Nobody but the DVM. The NOSTRAS
client sends AI jobs as NIP-90 encrypted requests: the input and
parameters are NIP-44 encrypted to the DVM's identity key, and the DVM
encrypts the result back to the requester. Anyone else watching the
relay sees ciphertext. Plaintext requests from other NIP-90 clients still
work, but they're public.

**Who can read it after the DVM decrypts it?** That depends on the model
backend, and the DVM says which in every job's model list:

| Privacy level | Meaning |
|---|---|
| `local` | Inference runs on hardware the DVM operator controls. The text isn't sent to any AI company. |
| `confidential` | A hosted service that can't read prompts (for example GPU enclaves with attestation). |
| `third-party` | A hosted API that can read prompts under its own data policy (Claude via Anthropic, for example). |

Whatever the backend, the DVM operator's own machine sees the plaintext
while it runs the job. "Local" means local to the operator, which for a
self-hosted NOSTRAS Node is you.

## Quick start: fully local with Ollama

You need Go (to build the relay and DVM) and [Ollama](https://ollama.com).

1. Pull a model and check Ollama's OpenAI-compatible endpoint:

   ```sh
   ollama pull gemma4
   curl -s http://localhost:11434/v1/models
   ```

2. Start the relay (listens on `:7777`):

   ```sh
   cd server && go run .
   ```

3. In another terminal, start the DVM against it:

   ```sh
   cd server
   NOSTRAS_LLM_BACKEND=openai \
   NOSTRAS_LLM_BASE_URL=http://localhost:11434/v1 \
   NOSTRAS_LLM_MODEL=gemma4:latest \
   NOSTRAS_LLM_REASONING_EFFORT=none \
   go run ./cmd/dvm
   ```

   The first lines of output should include:

   ```
   model: gemma4:latest via openai, privacy local (default)
   payment gating: OFF (set NOSTRAS_DVM_NWC_URI to enable)
   ```

   No Anthropic key is needed in this mode.

4. Check what the DVM advertises:

   ```sh
   curl -s localhost:7778/health | jq '{model, modelPrivacy, models}'
   ```

Point a NOSTRAS client at your relay (`VITE_RELAY_URL=ws://localhost:7777`
when building it) and Ask AI, Translate, Summarize and the spam check all
run on your model.

## Thinking models: set `NOSTRAS_LLM_REASONING_EFFORT=none`

Some models (gemma4 and qwen3 under Ollama, for example) "think" before
answering. Their hidden reasoning counts against `max_tokens`, so they can
spend the whole budget thinking and return an empty answer. In our tests,
gemma4 used all 60 tokens of a short question on reasoning and returned
nothing.

`NOSTRAS_LLM_REASONING_EFFORT=none` sends `reasoning_effort: "none"`,
which turns thinking off on servers that support it. If a model still
returns only reasoning, the DVM's error says so and suggests this setting
or a larger `NOSTRAS_LLM_MAX_TOKENS`.

## Hardware: be realistic

Local inference speed depends almost entirely on the GPU. Numbers from a
CPU-only desktop (Intel i5-6600, 4 cores, 16 GB RAM, no GPU) running
gemma4 (9.6 GB) through Ollama:

- A one-sentence answer of 18 tokens took about 9.5 seconds once the
  model was loaded.
- Three jobs sent at once (ask, translate, spam check) took about 150
  seconds in total, because Ollama runs them one after another.
- A 17 GB model didn't fit in RAM at all.

That's fine for testing and for a single user. For real traffic, use a
machine with a GPU whose memory fits the model, or point the DVM at a GPU
box on your private network (next section).

Set `NOSTRAS_LLM_TIMEOUT_SECONDS` (default 300) above your slowest
expected answer, and keep `NOSTRAS_LLM_MAX_TOKENS` modest on slow
hardware.

## A model server on another machine

`NOSTRAS_LLM_BASE_URL` can be any address the DVM can reach. If the host
is localhost, a private IP (`10.x`, `192.168.x`, …) or a `.internal` name
(Fly private networking), the privacy level defaults to `local`. Anything
else defaults to `third-party`. Override with `NOSTRAS_LLM_PRIVACY` when
you know better. `confidential` is never assumed; you have to declare it.

Don't expose Ollama's port to the internet. By default it listens only on
`127.0.0.1`. If you bind it to another interface for a remote DVM, keep
it behind a firewall or a private network such as Tailscale or WireGuard.

## Offering several models

The settings above define the default model. Add more OpenAI-compatible
models with `NOSTRAS_LLM_EXTRA_BACKENDS`, a JSON array. For example, Claude
as the default plus a local model:

```sh
NOSTRAS_ANTHROPIC_API_KEY=...            # default backend: anthropic
NOSTRAS_LLM_EXTRA_BACKENDS='[
  {"base_url": "http://localhost:11434/v1", "model": "gemma4:latest",
   "reasoning_effort": "none", "max_tokens": 400}
]'
```

Each entry accepts `base_url` and `model` (required), plus `api_key_env`,
`privacy`, `max_tokens`, `timeout_seconds`, `reasoning_effort`,
`input_usd_per_m` and `output_usd_per_m`. API keys never go in the JSON:
`api_key_env` names the environment variable that holds the key.

```sh
CONFIDENTIAL_KEY=...
NOSTRAS_LLM_EXTRA_BACKENDS='[
  {"base_url": "https://provider.example/v1", "model": "some-model",
   "privacy": "confidential", "api_key_env": "CONFIDENTIAL_KEY"}
]'
```

Model names must be unique across all backends.

### How clients choose

- The DVM's NIP-89 announcement (kind:31990, `d=nostras-dvm`) lists every
  model in its content: `"models": [{"id", "backend", "privacy",
  "default"}]`.
- A job picks a model with `["param", "model", "<id>"]`, inside the
  encrypted tags. No parameter means the default. An unknown id gets an
  error listing what's available.
- In the NOSTRAS client, the Ask AI view shows a model picker as soon as
  the DVM offers more than one model, with a note on who can see the
  question. The choice is saved on the device and used for all AI
  features, as long as the DVM still offers that model.

Check the announcement with `nak`:

```sh
nak req -k 31990 -t d=nostras-dvm ws://localhost:7777 | jq -s 'max_by(.created_at) | .content | fromjson | .models'
```

## Pricing

With `NOSTRAS_DVM_NWC_URI` set to a wallet connection that can create and
look up invoices, the DVM charges per job before running it. Without it,
it runs free.

- **Claude** jobs are priced from Anthropic's token count and the live
  BTC/USD rate.
- **OpenAI-compatible** backends charge the flat `NOSTRAS_DVM_PRICE_SATS`
  (default 21) unless you set `NOSTRAS_LLM_INPUT_USD_PER_M` /
  `NOSTRAS_LLM_OUTPUT_USD_PER_M` (or `input_usd_per_m` /
  `output_usd_per_m` per extra backend). Input tokens are then estimated
  at about four characters each, since OpenAI-compatible servers have no
  common token-count endpoint.

## Settings reference

| Variable | Default | Purpose |
|---|---|---|
| `NOSTRAS_LLM_BACKEND` | `anthropic` | Default backend: `anthropic` or `openai` |
| `NOSTRAS_ANTHROPIC_API_KEY` | | Required when the default backend is `anthropic` |
| `NOSTRAS_LLM_BASE_URL` | | OpenAI-compatible base URL, e.g. `http://localhost:11434/v1` |
| `NOSTRAS_LLM_MODEL` | | Model name sent to that server |
| `NOSTRAS_LLM_API_KEY` | | Bearer token, if the server needs one |
| `NOSTRAS_LLM_PRIVACY` | inferred | `local`, `confidential` or `third-party` |
| `NOSTRAS_LLM_REASONING_EFFORT` | | Sent as `reasoning_effort`; `none` disables thinking |
| `NOSTRAS_LLM_MAX_TOKENS` | `2048` | Maximum answer length |
| `NOSTRAS_LLM_TIMEOUT_SECONDS` | `300` | Per-request timeout |
| `NOSTRAS_LLM_INPUT_USD_PER_M` / `_OUTPUT_USD_PER_M` | | Per-token pricing; unset means flat price |
| `NOSTRAS_LLM_EXTRA_BACKENDS` | | JSON array of extra OpenAI-compatible models |
| `NOSTRAS_RELAY_URL` | `ws://localhost:7777` | Relay the DVM listens on |
| `NOSTRAS_DVM_IDENTITY_KEY` | random per boot | Hex secret key; set it so clients can keep encrypting to the same pubkey |
| `NOSTRAS_DVM_NWC_URI` | | Wallet connection for payment gating; unset = free |
| `NOSTRAS_DVM_PRICE_SATS` | `21` | Flat price per job |
| `NOSTRAS_DVM_HEALTH_PORT` | `7778` | Private health endpoint |

When run from `server/`, the DVM also reads unset variables from
`../.nostras.env`. That file is gitignored; never commit it.
