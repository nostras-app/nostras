import { useState } from 'react'
import { ndk } from '../lib/ndk'
import { getDevSigner } from '../lib/signer'
import { connectBunker, connectExtension, hasNip07Extension } from '../lib/remoteSigner'

type Step = 'choice' | 'login' | 'created'

export function AuthGate({ onReady }: { onReady: () => void }) {
  const [step, setStep] = useState<Step>('choice')
  const [uri, setUri] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newNsec, setNewNsec] = useState('')
  const [copied, setCopied] = useState(false)

  function handleAnonymous() {
    ndk.signer = getDevSigner()
    onReady()
  }

  function handleCreateAccount() {
    const signer = getDevSigner()
    setNewNsec(signer.nsec)
    ndk.signer = signer
    setStep('created')
  }

  async function handleConnectBunker() {
    if (!uri.trim()) return
    setBusy(true)
    setError(null)
    try {
      await connectBunker(uri.trim())
      onReady()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect')
    } finally {
      setBusy(false)
    }
  }

  async function handleConnectExtension() {
    setBusy(true)
    setError(null)
    try {
      await connectExtension()
      onReady()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect extension')
    } finally {
      setBusy(false)
    }
  }

  async function handleCopyNsec() {
    await navigator.clipboard.writeText(newNsec)
    setCopied(true)
  }

  return (
    <div className="auth-gate">
      <div className="card auth-gate-card">
        <div className="brand auth-gate-brand">
          <img src="/favicon.svg" alt="" className="brand-icon" />
          <h1>NOSTRAS</h1>
        </div>

        {step === 'choice' && (
          <div className="stack">
            <p className="field-hint">
              Nostr identity is just a keypair — no account to sign up
              for. Log in with one you already have, create a new one, or
              just try the app first.
            </p>
            <div className="stack">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStep('login')}
              >
                Log in
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCreateAccount}
              >
                Create new account
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAnonymous}
              >
                Continue anonymously
              </button>
            </div>
            <p className="field-hint">
              Anonymous creates a key stored only in this browser — you
              can connect a real signer later from Settings, but there's
              no backup shown for it now.
            </p>
          </div>
        )}

        {step === 'login' && (
          <div className="stack">
            <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleConnectExtension}
                disabled={busy || !hasNip07Extension()}
                title={
                  hasNip07Extension()
                    ? undefined
                    : 'No NIP-07 browser extension detected (e.g. Alby, nos2x)'
                }
              >
                {busy
                  ? 'Connecting…'
                  : hasNip07Extension()
                    ? 'Connect browser extension (NIP-07)'
                    : 'No extension detected'}
              </button>
            </div>
            <div className="field-row">
              <input
                className="input"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                placeholder="bunker://... (NIP-46)"
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleConnectBunker}
                disabled={busy || !uri.trim()}
              >
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            {error && <p className="alert-error">{error}</p>}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setStep('choice')
                setError(null)
              }}
            >
              Back
            </button>
          </div>
        )}

        {step === 'created' && (
          <div className="stack">
            <p className="alert-error">
              Save this key now. It's the only way back into this
              account — if you clear your browser or switch devices
              without it, this identity is gone for good.
            </p>
            <div className="auth-gate-nsec">{newNsec}</div>
            <button type="button" className="btn btn-secondary" onClick={handleCopyNsec}>
              {copied ? 'Copied' : 'Copy key'}
            </button>
            <button type="button" className="btn btn-primary" onClick={onReady}>
              I've saved it — continue
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
