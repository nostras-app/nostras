import { useState } from 'react'
import { ndk } from '../lib/ndk'
import {
  getIdentities,
  getActiveIdentityNpub,
  setActiveIdentityNpub,
  getIdentitySigner,
  createIdentity,
  importIdentity,
  removeIdentity,
  renameIdentity,
  isIdentityEncrypted,
  isIdentityLocked,
  encryptIdentity,
  unlockIdentity,
  type LocalIdentity,
} from '../lib/identities'
import { clearSignerSession, getSavedSignerMode } from '../lib/remoteSigner'

// Real request (2026-08-08): NOSTRAS already generates and hands the
// user a raw nsec client-side for "Create new account" — the honest
// complement is letting them paste one back in later, and switch
// between several self-custodied identities in one browser. Neither
// changes the project's non-custodial posture: every identity here
// only ever lives in this browser's localStorage, whether NOSTRAS
// generated it or the user imported one they already had.
//
// NIP-49 password encryption (2026-08-12): opt-in, per identity, only
// ever offered here after the fact — Create/Import above are completely
// unchanged. See lib/identities.ts's own comments for the storage/
// unlock-cache design and why the key security byte is always 0x00.
export function IdentitySettings() {
  const [identities, setIdentities] = useState<LocalIdentity[]>(getIdentities)
  const [activeNpub, setActiveNpubState] = useState<string | null>(getActiveIdentityNpub)
  const [usingRemoteSigner, setUsingRemoteSigner] = useState(() => getSavedSignerMode() !== null)
  const [revealNsec, setRevealNsec] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importValue, setImportValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  function refresh() {
    setIdentities(getIdentities())
    setActiveNpubState(getActiveIdentityNpub())
    setUsingRemoteSigner(getSavedSignerMode() !== null)
  }

  // Switching — to a different local identity, or off a connected
  // bunker/extension onto a local one — always clears any remote-signer
  // session first. Not just tidiness: App.tsx's boot resolution checks
  // for a saved remote-signer session *before* falling back to a local
  // identity, so leaving one in place would mean the switch silently
  // reverted back to the bunker on the next reload instead of sticking.
  // Returns whether it actually switched — an encrypted-and-locked
  // identity has no signer to switch to yet (the row's own inline
  // unlock form handles that case instead of calling this).
  function handleSwitch(npub: string): boolean {
    const signer = getIdentitySigner(npub)
    if (!signer) return false
    clearSignerSession()
    setActiveIdentityNpub(npub)
    ndk.signer = signer
    refresh()
    return true
  }

  function handleCreate() {
    const { identity, signer } = createIdentity()
    clearSignerSession()
    ndk.signer = signer
    setRevealNsec(identity.nsec ?? null)
    setCopied(false)
    refresh()
  }

  function handleImport() {
    if (!importValue.trim()) return
    setError(null)
    try {
      const { signer } = importIdentity(importValue.trim())
      clearSignerSession()
      ndk.signer = signer
      setImportValue('')
      setShowImport(false)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import that key')
    }
  }

  function handleRemove(npub: string) {
    const wasActive = !usingRemoteSigner && npub === activeNpub
    removeIdentity(npub)
    setConfirmRemove(null)
    // If the identity actually signed in right now was the one removed,
    // fall through to whatever's left rather than leaving ndk.signer
    // pointed at a key no longer in the saved list.
    if (wasActive) {
      const remaining = getIdentities()
      if (remaining.length > 0) {
        const signer = getIdentitySigner(remaining[0].npub)
        if (signer) {
          setActiveIdentityNpub(remaining[0].npub)
          ndk.signer = signer
        }
      }
    }
    refresh()
  }

  async function handleCopyNsec() {
    if (!revealNsec) return
    await navigator.clipboard.writeText(revealNsec)
    setCopied(true)
  }

  return (
    <div className="stack">
      <p className="field-hint">
        Every identity here lives only in this browser — NOSTRAS never
        sees or stores a copy anywhere else, whether it was generated
        here or imported. Switching clears any connected bunker/
        extension session first, so the switch actually sticks across a
        reload instead of silently reverting to it.
      </p>

      {revealNsec && (
        <div className="stack">
          <p className="alert-error">
            Save this key now — it's the only way back into this
            identity later.
          </p>
          <div className="auth-gate-nsec">{revealNsec}</div>
          <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopyNsec}>
              {copied ? 'Copied' : 'Copy key'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setRevealNsec(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {identities.length === 0 && !revealNsec && (
        <p className="field-hint">No saved identities in this browser yet.</p>
      )}

      {identities.length > 0 && (
        <ul className="identity-list">
          {identities.map((identity) => {
            const isActive = !usingRemoteSigner && identity.npub === activeNpub
            return (
              <IdentityRow
                key={identity.npub}
                identity={identity}
                isActive={isActive}
                confirmingRemove={confirmRemove === identity.npub}
                onSwitch={() => handleSwitch(identity.npub)}
                onRemove={() => handleRemove(identity.npub)}
                onConfirmRemove={() => setConfirmRemove(identity.npub)}
                onCancelRemove={() => setConfirmRemove(null)}
                onRename={(label) => {
                  setIdentities((prev) =>
                    prev.map((i) => (i.npub === identity.npub ? { ...i, label } : i)),
                  )
                }}
                onRenameCommit={(label) => {
                  renameIdentity(identity.npub, label)
                  refresh()
                }}
                onRefresh={refresh}
              />
            )
          })}
        </ul>
      )}

      <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleCreate}>
          Create new identity
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setShowImport((v) => !v)}
        >
          Import existing key
        </button>
      </div>

      {showImport && (
        <div className="stack">
          <p className="alert-error">
            Pasting a private key into any website is generally unsafe —
            only do this if you understand the risk and trust this
            device. The key stays local to this browser.
          </p>
          <input
            className="input"
            type="password"
            value={importValue}
            onChange={(e) => {
              setImportValue(e.target.value)
              setError(null)
            }}
            placeholder="nsec1..."
            autoComplete="off"
          />
          {error && <p className="alert-error">{error}</p>}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleImport}
            disabled={!importValue.trim()}
          >
            Import
          </button>
        </div>
      )}
    </div>
  )
}

function IdentityRow({
  identity,
  isActive,
  confirmingRemove,
  onSwitch,
  onRemove,
  onConfirmRemove,
  onCancelRemove,
  onRename,
  onRenameCommit,
  onRefresh,
}: {
  identity: LocalIdentity
  isActive: boolean
  confirmingRemove: boolean
  onSwitch: () => boolean
  onRemove: () => void
  onConfirmRemove: () => void
  onCancelRemove: () => void
  onRename: (label: string) => void
  onRenameCommit: (label: string) => void
  onRefresh: () => void
}) {
  const encrypted = isIdentityEncrypted(identity.npub)
  const locked = encrypted && isIdentityLocked(identity.npub)

  const [showEncryptForm, setShowEncryptForm] = useState(false)
  const [encryptPassword, setEncryptPassword] = useState('')
  const [encryptConfirm, setEncryptConfirm] = useState('')
  const [encryptError, setEncryptError] = useState<string | null>(null)
  const [encryptDone, setEncryptDone] = useState(false)

  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)

  function handleEncrypt() {
    if (!encryptPassword) return
    if (encryptPassword !== encryptConfirm) {
      setEncryptError("Passwords don't match.")
      return
    }
    try {
      encryptIdentity(identity.npub, encryptPassword)
      setEncryptPassword('')
      setEncryptConfirm('')
      setEncryptError(null)
      setShowEncryptForm(false)
      setEncryptDone(true)
      onRefresh()
    } catch (e) {
      setEncryptError(e instanceof Error ? e.message : 'Could not encrypt this identity')
    }
  }

  function handleUnlock() {
    if (!unlockPassword) return
    try {
      unlockIdentity(identity.npub, unlockPassword)
      setUnlockPassword('')
      setUnlockError(null)
      onSwitch()
      onRefresh()
    } catch {
      setUnlockError('Wrong password.')
    }
  }

  return (
    <li className="identity-row">
      <div className="identity-row-info">
        <input
          className="identity-label-input"
          value={identity.label}
          onChange={(e) => onRename(e.target.value)}
          onBlur={(e) => onRenameCommit(e.target.value)}
        />
        <span className="field-hint identity-npub">
          {identity.npub.slice(0, 16)}…
          {identity.imported ? ' · imported' : ''}
          {encrypted ? ' · 🔒 encrypted' : ''}
        </span>
      </div>

      {locked ? (
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>
          <input
            className="input"
            type="password"
            value={unlockPassword}
            onChange={(e) => {
              setUnlockPassword(e.target.value)
              setUnlockError(null)
            }}
            placeholder="Password"
            autoComplete="off"
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            style={{ maxWidth: 140 }}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleUnlock}
            disabled={!unlockPassword}
          >
            Unlock
          </button>
          {unlockError && <p className="alert-error">{unlockError}</p>}
        </div>
      ) : isActive ? (
        <span className="identity-active-badge">Active</span>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onSwitch}>
          Switch
        </button>
      )}

      {!encrypted && !confirmingRemove && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setShowEncryptForm((v) => !v)}
        >
          Encrypt with password
        </button>
      )}

      {confirmingRemove ? (
        <div className="btn-row">
          <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
            Confirm
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancelRemove}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="identity-remove-btn"
          onClick={onConfirmRemove}
          title="Remove from this browser — gone for good unless you've saved this key elsewhere"
        >
          Remove
        </button>
      )}

      {showEncryptForm && (
        <div className="stack" style={{ width: '100%' }}>
          <p className="field-hint">
            Sets a password this identity's key is encrypted with in this browser's storage.
            You'll need it again the next time you load the app or switch to this identity —
            there's no way to recover it if you forget it.
          </p>
          <input
            className="input"
            type="password"
            value={encryptPassword}
            onChange={(e) => {
              setEncryptPassword(e.target.value)
              setEncryptError(null)
            }}
            placeholder="New password"
            autoComplete="off"
          />
          <input
            className="input"
            type="password"
            value={encryptConfirm}
            onChange={(e) => {
              setEncryptConfirm(e.target.value)
              setEncryptError(null)
            }}
            placeholder="Confirm password"
            autoComplete="off"
          />
          {encryptError && <p className="alert-error">{encryptError}</p>}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleEncrypt}
            disabled={!encryptPassword || !encryptConfirm}
          >
            Encrypt
          </button>
        </div>
      )}

      {encryptDone && (
        <p className="field-hint" style={{ width: '100%' }}>
          Encrypted — you'll need this password next time you load the app or switch to this
          identity.
        </p>
      )}
    </li>
  )
}
