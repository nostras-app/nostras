import { useState } from 'react'
import { ndk } from '../lib/ndk'
import { unlockIdentity } from '../lib/identities'

// Shown at boot when the active identity is real and saved, but NIP-49
// encrypted and this tab hasn't unlocked it yet (App.tsx's
// getBootSignerState() 'locked' case) — distinct from AuthGate, which
// only ever appears when there's no identity to restore at all. A
// forgotten password doesn't hard-block the user out of the app: "Use a
// different identity instead" routes back to AuthGate's own choice
// screen, matching this project's standing philosophy of not gating
// people out (see logOff()'s own reasoning in authState.ts).
export function UnlockIdentityGate({
  npub,
  label,
  onUnlocked,
  onUseDifferent,
}: {
  npub: string
  label: string
  onUnlocked: () => void
  onUseDifferent: () => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function handleUnlock() {
    if (!password) return
    setBusy(true)
    setError(null)
    try {
      const signer = unlockIdentity(npub, password)
      ndk.signer = signer
      onUnlocked()
    } catch {
      setError('Wrong password, or this key is corrupted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-gate">
      <div className="card auth-gate-card">
        <div className="brand auth-gate-brand">
          <img src="/favicon.svg" alt="" className="brand-icon" />
          <h1>NOSTRAS</h1>
        </div>
        <div className="stack">
          <p className="field-hint">
            <strong>{label}</strong> ({npub.slice(0, 16)}…) is password-protected. Enter its
            password to continue — it's checked only in your browser, never sent anywhere.
          </p>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            placeholder="Password"
            autoComplete="off"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          />
          {error && <p className="alert-error">{error}</p>}
          <button type="button" className="btn btn-primary" onClick={handleUnlock} disabled={busy || !password}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onUseDifferent}>
            Use a different identity instead
          </button>
        </div>
      </div>
    </div>
  )
}
