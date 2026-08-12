import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'

export interface LocalIdentity {
  npub: string
  // Exactly one of nsec/ncryptsec is present. Plaintext identities
  // (the only kind that existed before NIP-49 support) keep nsec;
  // encrypting one (Settings > Identities, opt-in, after the fact —
  // never offered inline at Create/Import time) replaces it with
  // ncryptsec and removes the plaintext value from storage entirely.
  nsec?: string
  ncryptsec?: string
  label: string
  createdAt: number
  imported: boolean
}

// Decrypted signers for encrypted identities, kept in memory only for
// this tab's lifetime — never written to storage. This is what actually
// makes the encryption mean something: a reload clears it, requiring
// the password again, rather than the decrypted key persisting
// somewhere an attacker with storage/disk access could also read.
const unlocked = new Map<string, NDKPrivateKeySigner>()

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
// for a genuinely first-time visitor. Only ever called from that path
// (AuthGate, when hasAnyLocalIdentity() is already false), so an
// encrypted-and-locked active identity should never reach here in
// practice — App.tsx's own boot resolution uses getBootSignerState()
// instead, specifically because it needs to handle that case. Throws
// rather than silently misbehaving if it's ever called against one
// anyway.
export function getActiveIdentitySigner(): NDKPrivateKeySigner {
  const identities = load()
  const activeNpub = getActiveIdentityNpub()
  const active = identities.find((i) => i.npub === activeNpub) ?? identities[0]
  if (active) {
    if (active.ncryptsec) {
      const cached = unlocked.get(active.npub)
      if (cached) return cached
      throw new Error('Active identity is encrypted and locked')
    }
    if (!active.nsec) throw new Error('Identity has neither nsec nor ncryptsec')
    return new NDKPrivateKeySigner(active.nsec)
  }
  return createIdentity().signer
}

// Resolves a signer for a specific saved identity by npub — used by the
// identity switcher (Settings > Identities) to switch to any of several
// saved identities, not just whichever one is currently active. For an
// encrypted identity, returns the cached unlocked signer if this
// session has already unlocked it, else null — the same "not available"
// signal every existing caller already handles; isIdentityLocked() is
// what UI code uses to tell "locked" apart from "doesn't exist".
export function getIdentitySigner(npub: string): NDKPrivateKeySigner | null {
  const identity = load().find((i) => i.npub === npub)
  if (!identity) return null
  if (identity.ncryptsec) return unlocked.get(npub) ?? null
  return identity.nsec ? new NDKPrivateKeySigner(identity.nsec) : null
}

export function isIdentityEncrypted(npub: string): boolean {
  return !!load().find((i) => i.npub === npub)?.ncryptsec
}

export function isIdentityLocked(npub: string): boolean {
  return isIdentityEncrypted(npub) && !unlocked.has(npub)
}

// Encrypts an already-saved identity's key with a password, replacing
// its plaintext nsec in storage with a real NIP-49 ncryptsec — opt-in,
// only ever run after the fact from Settings > Identities, never at
// Create/Import time. Key security byte is always 0x00 ("known to have
// been handled insecurely"), not 0x01 — every identity this function
// can run against has, by definition, already sat as plaintext in
// localStorage before this call, so 0x01 ("not known to be handled
// insecurely") would be a false claim. Revisit this if an "encrypt at
// creation" path is ever added — that key genuinely never touches
// plaintext storage, so 0x01 would be honest there.
export function encryptIdentity(npub: string, password: string): void {
  const identities = load()
  const identity = identities.find((i) => i.npub === npub)
  if (!identity) throw new Error('Identity not found')
  if (!identity.nsec) throw new Error('This identity is already encrypted')
  const signer = new NDKPrivateKeySigner(identity.nsec)
  const ncryptsec = signer.encryptToNcryptsec(password, 16, 0x00)
  save(identities.map((i) => (i.npub === npub ? { ...i, nsec: undefined, ncryptsec } : i)))
  // The identity was already unlocked a moment ago (it was plaintext) —
  // keep it that way so encrypting an identity doesn't lock the user
  // out of their own currently-active session.
  unlocked.set(npub, signer)
}

// Decrypts an encrypted identity with its password, caching the result
// in memory for the rest of this tab's session (see the `unlocked` map
// comment above) and returning it. Throws a real, catchable error on a
// wrong password — verified directly against the installed nostr-
// tools/nip49: a wrong password fails the AEAD's own authentication
// check ("invalid tag"), it doesn't silently return garbage.
export function unlockIdentity(npub: string, password: string): NDKPrivateKeySigner {
  const identity = load().find((i) => i.npub === npub)
  if (!identity?.ncryptsec) throw new Error('Identity not found or not encrypted')
  const signer = NDKPrivateKeySigner.fromNcryptsec(identity.ncryptsec, password)
  unlocked.set(npub, signer)
  return signer
}

// What App.tsx's boot sequence needs to resolve the active identity
// without assuming a signer can always be produced synchronously — an
// encrypted-and-locked active identity needs a password from the user
// first, which getActiveIdentitySigner()'s always-returns-a-signer
// contract can't express.
export type BootSignerState =
  | { kind: 'signer'; signer: NDKPrivateKeySigner }
  | { kind: 'locked'; npub: string; label: string }
  | { kind: 'none' }

export function getBootSignerState(): BootSignerState {
  const identities = load()
  const activeNpub = getActiveIdentityNpub()
  const active = identities.find((i) => i.npub === activeNpub) ?? identities[0]
  if (!active) return { kind: 'none' }
  if (active.ncryptsec) {
    const cached = unlocked.get(active.npub)
    if (cached) return { kind: 'signer', signer: cached }
    return { kind: 'locked', npub: active.npub, label: active.label }
  }
  if (!active.nsec) return { kind: 'none' }
  return { kind: 'signer', signer: new NDKPrivateKeySigner(active.nsec) }
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
  unlocked.delete(npub)
  if (getActiveIdentityNpub() === npub) {
    localStorage.removeItem(ACTIVE_KEY)
  }
}

export function renameIdentity(npub: string, label: string) {
  const trimmed = label.trim()
  if (!trimmed) return
  save(load().map((i) => (i.npub === npub ? { ...i, label: trimmed } : i)))
}
