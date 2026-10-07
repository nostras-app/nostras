#!/usr/bin/env bash
# Synthesizes speech via the Gemini TTS API (generateContent with
# responseModalities:["AUDIO"]) -- the well-established REST shape,
# not the newer "Interactions API" surface some docs now mention,
# since this one is the one we could actually cross-confirm.
#
# Usage: ./gemini-tts.sh <voice-name> <output-wav-path> [model]
#   Text to speak is read from stdin, so a style-instruction prefix and
#   the real script text can both be piped in together, e.g.:
#     printf 'Say this warmly and conversationally, like a podcast host: %s' "$SCRIPT_TEXT" \
#       | ./gemini-tts.sh Sulafat scratch/sample-sulafat.wav
#
# Requires NOSTRAS_GEMINI_API_KEY in the project root's .nostras.env
# (this project's existing shared-secrets convention, same file as
# NOSTRAS_ANTHROPIC_API_KEY/NOSTRAS_DVM_NWC_URI) -- never passed on the
# command line or typed into chat.
set -euo pipefail

VOICE="${1:?usage: gemini-tts.sh <voice-name> <output-wav-path> [model]}"
OUT="${2:?usage: gemini-tts.sh <voice-name> <output-wav-path> [model]}"
MODEL="${3:-gemini-2.5-flash-preview-tts}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_ENV="$SCRIPT_DIR/../../../.nostras.env"
# .nostras.env isn't a strictly shell-sourceable file (main.go reads it
# with its own minimal hand-rolled parser, not `source`) -- pull out just
# this one KEY=VALUE line by pattern instead of sourcing the whole file,
# which broke on an unrelated line containing an unquoted parenthesis.
if [ -f "$ROOT_ENV" ]; then
  GEMINI_API_KEY="$(grep -m1 '^NOSTRAS_GEMINI_API_KEY=' "$ROOT_ENV" | cut -d= -f2-)"
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "NOSTRAS_GEMINI_API_KEY not set -- add it to $ROOT_ENV" >&2
  exit 1
fi

TEXT="$(cat)"
if [ -z "$TEXT" ]; then
  echo "no text provided on stdin" >&2
  exit 1
fi

TMP_JSON="$(mktemp)"
TMP_RESP="$(mktemp)"
trap 'rm -f "$TMP_JSON" "$TMP_RESP"' EXIT

# jq builds the request body so TEXT's own quotes/newlines are escaped
# correctly, rather than hand-interpolating it into a JSON literal.
jq -n --arg text "$TEXT" --arg voice "$VOICE" '{
  contents: [{parts: [{text: $text}]}],
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {voiceName: $voice}
      }
    }
  }
}' > "$TMP_JSON"

HTTP_CODE=$(curl -s -o "$TMP_RESP" -w "%{http_code}" \
  "https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent" \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d @"$TMP_JSON")

if [ "$HTTP_CODE" != "200" ]; then
  echo "Gemini API returned HTTP $HTTP_CODE:" >&2
  cat "$TMP_RESP" >&2
  exit 1
fi

B64_AUDIO=$(jq -r '.candidates[0].content.parts[0].inlineData.data // empty' "$TMP_RESP")
MIME=$(jq -r '.candidates[0].content.parts[0].inlineData.mimeType // empty' "$TMP_RESP")

if [ -z "$B64_AUDIO" ]; then
  echo "No audio data in response:" >&2
  cat "$TMP_RESP" >&2
  exit 1
fi

echo "mimeType: $MIME" >&2

TMP_PCM="$(mktemp)"
trap 'rm -f "$TMP_JSON" "$TMP_RESP" "$TMP_PCM"' EXIT
base64 -d <<< "$B64_AUDIO" > "$TMP_PCM"

# Gemini TTS returns raw 16-bit signed little-endian PCM at 24kHz mono --
# sox can read that directly given the right -t raw flags, no separate
# wave-header step needed.
sox -t raw -r 24000 -e signed -b 16 -c 1 "$TMP_PCM" "$OUT"

echo "wrote $OUT" >&2
