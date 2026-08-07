import { nip19 } from '@nostr-dev-kit/ndk'

// Accepts whatever form someone might have a pubkey in — raw hex (the
// format NoteMenu's "Copy user ID" and "View raw event" both surface),
// npub, or nprofile — and resolves it to a plain hex pubkey, or null if
// the input isn't identity-shaped at all (a normal search term).
export function resolvePubkeyInput(input: string): string | null {
  const trimmed = input.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed

  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === 'npub') return decoded.data
    if (decoded.type === 'nprofile') return decoded.data.pubkey
  } catch {
    // Not a valid bech32-encoded identity — falls through to null,
    // meaning "treat this as a normal search term" at the call site.
  }
  return null
}
