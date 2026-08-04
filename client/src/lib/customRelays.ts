import { normalizeRelayUrl } from '@nostr-dev-kit/ndk'

// Pure localStorage CRUD, deliberately no `ndk` import here — `ndk.ts`
// imports getCustomRelays() to seed its explicitRelayUrls at startup, so
// this file must not import back from `ndk.ts` or module init would cycle.
// Applying a change to the live pool (ndk.pool.getRelay/removeRelay) is the
// UI layer's job (RelaySettings.tsx), not this module's.
const STORAGE_KEY = 'nostras:custom-relays'

export function isValidRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:'
  } catch {
    return false
  }
}

export function getCustomRelays(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : []
  } catch {
    return []
  }
}

function persist(urls: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(urls))
}

// Returns the normalized URL that was added, or null if it was already
// present. Caller is expected to have validated with isValidRelayUrl first.
export function addCustomRelayUrl(url: string): string | null {
  const normalized = normalizeRelayUrl(url)
  const existing = getCustomRelays()
  if (existing.includes(normalized)) return null
  persist([...existing, normalized])
  return normalized
}

export function removeCustomRelayUrl(url: string) {
  persist(getCustomRelays().filter((u) => u !== url))
}
