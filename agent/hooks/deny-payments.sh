#!/usr/bin/env bash
# Layer 2 of 3 in the daemon's financial-safety design (see CLAUDE.md's
# "Financial safety — layered, not a single soft rule" entry for the
# other two: an --append-system-prompt reminder, and the daemon's own
# process never holding NOSTRAS_DVM_NWC_URI at all). A real technical
# backstop independent of model judgment — not foolproof against a
# sufficiently indirect script, but a genuine second layer, applied ONLY
# to this daemon's headless invocations via --settings, never to the
# operator's own interactive sessions in this repo.
set -euo pipefail

payload="$(cat)"
command="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')"

if printf '%s' "$command" | grep -qiE 'pay_invoice|lnbc[0-9]|bolt11|nwc\.go|NOSTRAS_DVM_NWC_URI'; then
  reason='Blocked by nostr-agent financial-safety hook: command looks payment-shaped (pay_invoice/lnbc/bolt11/nwc.go/NOSTRAS_DVM_NWC_URI). This daemon must never send a Lightning payment.'
  jq -n --arg reason "$reason" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
else
  echo '{}'
fi
