import { useEffect, useState } from 'react'
import { createArkWallet, loadArkMnemonic, syncArkWallet, useArkWallet } from '../lib/arkWallet'

// Experimental — Ark protocol (https://ark-protocol.org), Signet test
// network only, zero real money involved anywhere in this component.
// See lib/arkWallet.ts's own comment for why this is scoped this way,
// and nostr-client-node-strategy.md's "Exploratory: growth strategy
// options" section for the full research/decision record.
export function ArkWalletSettings() {
  const { status, address, balanceSats, syncing, error } = useArkWallet()
  const [revealedMnemonic, setRevealedMnemonic] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)

  // If a wallet already exists (created in an earlier session), it's
  // opened once at app boot (App.tsx) — this component itself never
  // triggers that, only reflects the resulting state.
  const hasStoredWallet = !!loadArkMnemonic()

  // Copied-state resets whenever the user switches what they're looking
  // at, same pattern as NwcConnect/AuthGate's own copy buttons.
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  async function handleCreate() {
    setCreating(true)
    try {
      const mnemonic = await createArkWallet()
      setRevealedMnemonic(mnemonic)
    } finally {
      setCreating(false)
    }
  }

  function handleCopyMnemonic() {
    if (!revealedMnemonic) return
    navigator.clipboard.writeText(revealedMnemonic)
    setCopied(true)
  }

  function handleCopyAddress() {
    if (!address) return
    navigator.clipboard.writeText(address)
    setCopied(true)
  }

  return (
    <div className="stack">
      <p className="ark-wallet-experimental-banner">
        EXPERIMENTAL — Signet test network only. Not real money, ever.
      </p>

      {/* Still revealing the just-created mnemonic — this state wins
          over "ready" even though the wallet is already open, since the
          one-time reveal has to happen before anything else. */}
      {revealedMnemonic ? (
        <div className="stack">
          <p className="alert-error">
            Save this now if you want to recover this wallet later —
            it's Signet test bitcoin with no real value, but the same
            "lost seed, lost wallet" rule as a real one applies.
          </p>
          <div className="auth-gate-nsec">{revealedMnemonic}</div>
          <button type="button" className="btn btn-secondary" onClick={handleCopyMnemonic}>
            {copied ? 'Copied' : 'Copy seed phrase'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setRevealedMnemonic(null)}
          >
            I've saved it — continue
          </button>
        </div>
      ) : status === 'ready' && address ? (
        <div className="stack">
          <div className="field-row" style={{ alignItems: 'center' }}>
            <p className="field-hint" style={{ flex: 1, wordBreak: 'break-all' }}>
              {address}
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopyAddress}>
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>
          <div className="field-row" style={{ alignItems: 'center' }}>
            <p className="field-hint" style={{ flex: 1 }}>
              Balance: <strong>{balanceSats ?? 0} test sats</strong> (Signet — not real money)
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => syncArkWallet()}
              disabled={syncing}
            >
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
          </div>
          {error && <p className="alert-error">{error}</p>}
        </div>
      ) : status === 'opening' || (hasStoredWallet && status === 'none') ? (
        <p className="field-hint">Opening wallet…</p>
      ) : (
        <div className="stack">
          <p className="field-hint">
            A real, working{' '}
            <a href="https://ark-protocol.org" target="_blank" rel="noreferrer">
              Ark protocol
            </a>{' '}
            wallet — instant off-chain Bitcoin payments with no Lightning-
            style channel liquidity to manage. Running against a real
            public Signet test server, not a simulation, but Signet
            bitcoin has zero real-world value. This is here to try, not
            to rely on.
          </p>
          {error && <p className="alert-error">{error}</p>}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? 'Creating…' : 'Create Ark Wallet (Signet)'}
          </button>
        </div>
      )}
    </div>
  )
}
