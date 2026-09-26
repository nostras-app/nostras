import { nip19 } from '@nostr-dev-kit/ndk'
import { ndk } from './ndk'

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

// resolvePubkeyInput plus NIP-05 (`name@domain`), which needs a network
// lookup of the domain's .well-known/nostr.json. Bounded so a dead domain
// can't hang the caller.
export async function resolvePubkeyOrNip05(input: string): Promise<string | null> {
  const direct = resolvePubkeyInput(input)
  if (direct) return direct
  const trimmed = input.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  try {
    const user = await Promise.race([
      ndk.getUserFromNip05(trimmed),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 8000)),
    ])
    return user?.pubkey ?? null
  } catch {
    return null
  }
}

export type NoteReference = { id: string; relays: string[] }

// Same idea as resolvePubkeyInput but for a specific note — `note`
// (bare id) or `nevent` (id + optional relay hints, e.g. from another
// client's "copy note link"). deeplink.ts's own comment used to say
// "NOSTRAS has no dedicated single-note view to redirect a plain nevent
// to" — this is what closes that gap, for both search-box paste and
// (via lib/deeplink.ts) a real nostr: deep link.
export function resolveNoteReference(input: string): NoteReference | null {
  const trimmed = input.trim()
  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === 'note') return { id: decoded.data, relays: [] }
    if (decoded.type === 'nevent') {
      return { id: decoded.data.id, relays: decoded.data.relays ?? [] }
    }
  } catch {
    // Not a valid bech32-encoded note reference — falls through to null.
  }
  return null
}
