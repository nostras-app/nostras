// The real, already-public MMO pubkey used throughout this project's own
// verification history — the sole trusted sender. Overridable via env in
// case this ever needs to run for a different owner, but never left
// unset: an unset allowlist would mean trusting nobody, not everybody,
// so this has no insecure default to fall back to.
export function ownerPubkeyHex() {
  return process.env.NOSTR_AGENT_OWNER_PUBKEY ||
    '0da1a169a4e684d0b0ac1a370871575e4b8f3c56c8a7411b9ff7f27aea6c90e7'
}
