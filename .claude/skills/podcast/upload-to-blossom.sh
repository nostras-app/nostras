#!/usr/bin/env bash
# Uploads a file to blossom.primal.net using the podcast skill's own
# dedicated, purpose-built keypair (uploader-key.txt, gitignored, zero
# real value/reputation — a technical utility key, not a real identity).
# Replicates the exact BUD-11 flow client/src/lib/blossom.ts already
# proved works against this real server: standard base64 (WITH padding)
# for the Authorization header, not the spec's base64url-without-padding
# — blossom.primal.net rejects the spec-literal encoding in practice,
# confirmed by this project's own earlier real testing.
#
# Usage: upload-to-blossom.sh <file-path> <content-type>
# Prints the resulting public URL to stdout on success.
set -euo pipefail

FILE="$1"
CONTENT_TYPE="$2"
SKILLDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SK="$(cat "$SKILLDIR/uploader-key.txt")"

SHA256="$(sha256sum "$FILE" | cut -d' ' -f1)"
EXPIRATION=$(($(date +%s) + 300))

EVENT_JSON="$(nak event -k 24242 -c "Upload file" -t "t=upload" -t "x=$SHA256" -t "expiration=$EXPIRATION" --sec "$SK")"
AUTH_B64="$(printf '%s' "$EVENT_JSON" | base64 -w0)"

RESPONSE="$(curl -sS --max-time 60 -X PUT \
  -H "Authorization: Nostr $AUTH_B64" \
  -H "Content-Type: $CONTENT_TYPE" \
  --data-binary "@$FILE" \
  https://blossom.primal.net/upload)"

URL="$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])" 2>/dev/null)"
if [ -z "$URL" ]; then
  echo "Upload failed. Server response: $RESPONSE" >&2
  exit 1
fi
echo "$URL"
