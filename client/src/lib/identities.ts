import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'

export interface LocalIdentity {
  npub: string
  nsec: string
  label: string
  createdAt: number
  imported: boolean
}

const IDENTITIES_KEY = 'nostras:identities'
const ACTIVE_KEY = 'nostras:active-identity'
// The original single-identity storage key, from before multi-identity
// support existed — real users already have a real identity sitting
// under this key, so migrating it forward (not just supporting fresh
// installs) matters. Left in place, unused, after migrating rather than
// deleted, as a safety net.
const LEGACY_KEY = 'nostras:dev-signer-nsec'

let migrated = false

// Runs once per page load, before anything else in this module touches
// storage. Wraps the legacy nsec (if any) in a single LocalIdentity and
// marks it active, so a returning user with only the old storage format
// sees exactly the identity they already had — not a "no identity, start
// over" state.
function migrateLegacyIfNeeded() {
  if (migrated) return
  migrated = true
  if (localStorage.getItem(IDENTITIES_KEY)) return
  const legacyNsec = localStorage.getItem(LEGACY_KEY)
  if (!legacyNsec) return
  try {
    const signer = new NDKPrivateKeySigner(legacyNsec)
    const identity: LocalIdentity = {
      npub: signer.npub,
      nsec: legacyNsec,
      label: 'My identity',
      createdAt: Date.now(),
      imported: false,
    }
    localStorage.setItem(IDENTITIES_KEY, JSON.stringify([identity]))
    localStorage.setItem(ACTIVE_KEY, identity.npub)
  } catch {
    // Malformed legacy value — nothing usable to migrate.
  }
}

function load(): LocalIdentity[] {
  migrateLegacyIfNeeded()
  try {
    const raw = localStorage.getItem(IDENTITIES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as LocalIdentity[]) : []
  } catch {
    return []
  }
}

function save(identities: LocalIdentity[]) {
  localStorage.setItem(IDENTITIES_KEY, JSON.stringify(identities))
}

export function getIdentities(): LocalIdentity[] {
  return load()
}

export function hasAnyLocalIdentity(): boolean {
  return load().length > 0
}

export function getActiveIdentityNpub(): string | null {
  migrateLegacyIfNeeded()
  return localStorage.getItem(ACTIVE_KEY)
}

export function setActiveIdentityNpub(npub: string) {
  localStorage.setItem(ACTIVE_KEY, npub)
}

// Resolves a real signer for whichever local identity is active,
// creating a fresh one (silently, no nsec shown) if none exists yet —
// this is what "Continue anonymously" has always done, preserved exactly
// for a genuinely first-time visitor.
export function getActiveIdentitySigner(): NDKPrivateKeySigner {
  const identities = load()
  const activeNpub = getActiveIdentityNpub()
  const active = identities.find((i) => i.npub === activeNpub) ?? identities[0]
  if (active) return new NDKPrivateKeySigner(active.nsec)
  return createIdentity().signer
}

// Resolves a signer for a specific saved identity by npub — used by the
// identity switcher (Settings > Identities) to switch to any of several
// saved identities, not just whichever one is currently active.
export function getIdentitySigner(npub: string): NDKPrivateKeySigner | null {
  const identity = load().find((i) => i.npub === npub)
  return identity ? new NDKPrivateKeySigner(identity.nsec) : null
}

// Always creates a genuinely new identity, regardless of what already
// exists — this is "Create new account"'s real job, distinct from
// getActiveIdentitySigner()'s "reuse if present" behavior.
export function createIdentity(label?: string): { identity: LocalIdentity; signer: NDKPrivateKeySigner } {
  const signer = NDKPrivateKeySigner.generate()
  const identities = load()
  const identity: LocalIdentity = {
    npub: signer.npub,
    nsec: signer.nsec,
    label: label?.trim() || `Identity ${identities.length + 1}`,
    createdAt: Date.now(),
    imported: false,
  }
  save([...identities, identity])
  setActiveIdentityNpub(identity.npub)
  return { identity, signer }
}

// Imports an existing nsec pasted in by the user. Throws (synchronously,
// via NDKPrivateKeySigner's own constructor validation) for a malformed
// key or one that isn't actually an nsec — the caller surfaces that as a
// real error, not a silent failure.
export function importIdentity(
  nsecOrHex: string,
  label?: string,
): { identity: LocalIdentity; signer: NDKPrivateKeySigner } {
  const trimmed = nsecOrHex.trim()
  const signer = new NDKPrivateKeySigner(trimmed)
  const identities = load()
  if (identities.some((i) => i.npub === signer.npub)) {
    throw new Error('This key is already saved in this browser.')
  }
  const identity: LocalIdentity = {
    npub: signer.npub,
    nsec: trimmed,
    label: label?.trim() || `Identity ${identities.length + 1}`,
    createdAt: Date.now(),
    imported: true,
  }
  save([...identities, identity])
  setActiveIdentityNpub(identity.npub)
  return { identity, signer }
}

export function removeIdentity(npub: string) {
  save(load().filter((i) => i.npub !== npub))
  if (getActiveIdentityNpub() === npub) {
    localStorage.removeItem(ACTIVE_KEY)
  }
}

export function renameIdentity(npub: string, label: string) {
  const trimmed = label.trim()
  if (!trimmed) return
  save(load().map((i) => (i.npub === npub ? { ...i, label: trimmed } : i)))
}
