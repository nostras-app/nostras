import { useEffect, useState } from 'react'
import type { LightningSendStatus } from '@secondts/bark/web'
import {
  boardAllFunds,
  checkLightningReceive,
  createArkWallet,
  createLightningInvoice,
  forgetArkWallet,
  loadArkMnemonic,
  payLightningInvoiceViaArk,
  sendArkPayment,
  syncArkWallet,
  syncOnchainWallet,
  useArkWallet,
} from '../lib/arkWallet'

// Experimental — Ark protocol (https://ark-protocol.org), Signet test
// network only, zero real money involved anywhere in this component.
// See lib/arkWallet.ts's own comment for why this is scoped this way,
// and nostr-client-node-strategy.md's "Exploratory: growth strategy
// options" section for the full research/decision record.
export function ArkWalletSettings() {
  const {
    status,
    address,
    balanceSats,
    syncing,
    error,
    onchainAddress,
    onchainBalanceSats,
    onchainSyncing,
    boarding,
  } = useArkWallet()
  const [revealedMnemonic, setRevealedMnemonic] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [onchainCopied, setOnchainCopied] = useState(false)
  const [confirmingForget, setConfirmingForget] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [sendAddress, setSendAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [boardSuccess, setBoardSuccess] = useState(false)
  const [lnAmount, setLnAmount] = useState('')
  const [lnDescription, setLnDescription] = useState('')
  const [creatingInvoice, setCreatingInvoice] = useState(false)
  const [lnInvoice, setLnInvoice] = useState<{ invoice: string; paymentHash: string } | null>(null)
  const [lnInvoiceCopied, setLnInvoiceCopied] = useState(false)
  const [checkingReceive, setCheckingReceive] = useState(false)
  const [lnReceiveState, setLnReceiveState] = useState<string | null>(null)
  const [lnError, setLnError] = useState<string | null>(null)
  const [lnPayInvoice, setLnPayInvoice] = useState('')
  const [paying, setPaying] = useState(false)
  const [payResult, setPayResult] = useState<LightningSendStatus | null>(null)
  const [payError, setPayError] = useState<string | null>(null)

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

  useEffect(() => {
    if (!sendSuccess) return
    const t = setTimeout(() => setSendSuccess(false), 3000)
    return () => clearTimeout(t)
  }, [sendSuccess])

  useEffect(() => {
    if (!onchainCopied) return
    const t = setTimeout(() => setOnchainCopied(false), 1500)
    return () => clearTimeout(t)
  }, [onchainCopied])

  useEffect(() => {
    if (!boardSuccess) return
    const t = setTimeout(() => setBoardSuccess(false), 5000)
    return () => clearTimeout(t)
  }, [boardSuccess])

  useEffect(() => {
    if (!lnInvoiceCopied) return
    const t = setTimeout(() => setLnInvoiceCopied(false), 1500)
    return () => clearTimeout(t)
  }, [lnInvoiceCopied])

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

  function handleCopyOnchainAddress() {
    if (!onchainAddress) return
    navigator.clipboard.writeText(onchainAddress)
    setOnchainCopied(true)
  }

  async function handleBoardAll() {
    setBoardError(null)
    setBoardSuccess(false)
    try {
      await boardAllFunds()
      setBoardSuccess(true)
    } catch (e) {
      setBoardError(e instanceof Error ? e.message : 'Boarding failed')
    }
  }

  async function handleCreateInvoice() {
    const amount = Number.parseInt(lnAmount, 10)
    if (!Number.isFinite(amount) || amount <= 0) return
    setCreatingInvoice(true)
    setLnError(null)
    setLnReceiveState(null)
    try {
      const result = await createLightningInvoice(amount, lnDescription.trim() || undefined)
      setLnInvoice(result)
    } catch (e) {
      setLnError(e instanceof Error ? e.message : 'Could not create invoice')
    } finally {
      setCreatingInvoice(false)
    }
  }

  function handleCopyInvoice() {
    if (!lnInvoice) return
    navigator.clipboard.writeText(lnInvoice.invoice)
    setLnInvoiceCopied(true)
  }

  function handleNewInvoice() {
    setLnInvoice(null)
    setLnReceiveState(null)
    setLnAmount('')
    setLnDescription('')
  }

  async function handleCheckReceive() {
    if (!lnInvoice) return
    setCheckingReceive(true)
    setLnError(null)
    try {
      const state = await checkLightningReceive(lnInvoice.paymentHash)
      setLnReceiveState(state)
    } catch (e) {
      setLnError(e instanceof Error ? e.message : 'Could not check status')
    } finally {
      setCheckingReceive(false)
    }
  }

  async function handlePayInvoice() {
    if (!lnPayInvoice.trim()) return
    setPaying(true)
    setPayError(null)
    setPayResult(null)
    try {
      const result = await payLightningInvoiceViaArk(lnPayInvoice)
      setPayResult(result)
      if (result.type === 'paid') setLnPayInvoice('')
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  async function handleSend() {
    const amount = Number.parseInt(sendAmount, 10)
    if (!sendAddress.trim() || !Number.isFinite(amount) || amount <= 0) return
    setSending(true)
    setSendError(null)
    setSendSuccess(false)
    try {
      await sendArkPayment(sendAddress.trim(), amount)
      setSendAddress('')
      setSendAmount('')
      setSendSuccess(true)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function handleForget() {
    setForgetting(true)
    try {
      await forgetArkWallet()
    } finally {
      setForgetting(false)
      setConfirmingForget(false)
    }
  }

  return (
    <div className="stack">
      <p className="ark-wallet-experimental-banner">
        EXPERIMENTAL — Signet test network only. Not real money, ever.
      </p>
      <p className="field-hint">
        A working{' '}
        <a href="https://ark-protocol.org" target="_blank" rel="noreferrer">
          Ark protocol
        </a>{' '}
        wallet, built on{' '}
        <a href="https://second.tech/docs/bark-wallet" target="_blank" rel="noreferrer">
          Second's Bark Wallet SDK
        </a>{' '}
        — instant off-chain Bitcoin payments with no Lightning-style
        channel liquidity to manage. Ark is a separate Bitcoin-layer
        protocol, not a Nostr NIP — nothing about it runs over Nostr
        relays, unlike the NWC wallet above. It talks to Second's public{' '}
        <strong>Signet</strong> server — a genuine Bitcoin test network,
        not a local simulation, but one whose bitcoin has always had zero
        real-world value and never will. Here to try, not to rely on.
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
          <div className="stack">
            <p className="field-hint">
              <strong>Fund this wallet (boarding)</strong> — send Signet
              test bitcoin to this on-chain address, then board it into
              Ark. Get free Signet coins from a{' '}
              <a href="https://mempool.space/signet/faucet" target="_blank" rel="noreferrer">
                public Signet faucet
              </a>{' '}
              (same chain this wallet talks to — independently confirmed,
              not assumed). Boarded funds need 6 real on-chain
              confirmations before they're spendable in Ark.
            </p>
            {onchainAddress && (
              <div className="field-row" style={{ alignItems: 'center' }}>
                <p className="field-hint" style={{ flex: 1, wordBreak: 'break-all' }}>
                  {onchainAddress}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleCopyOnchainAddress}
                >
                  {onchainCopied ? 'Copied' : 'Copy address'}
                </button>
              </div>
            )}
            <div className="field-row" style={{ alignItems: 'center' }}>
              <p className="field-hint" style={{ flex: 1 }}>
                On-chain balance: <strong>{onchainBalanceSats ?? 0} test sats</strong>
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => syncOnchainWallet()}
                disabled={onchainSyncing}
              >
                {onchainSyncing ? 'Syncing…' : 'Sync on-chain'}
              </button>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleBoardAll}
              disabled={boarding || !onchainBalanceSats}
            >
              {boarding ? 'Boarding…' : 'Board all on-chain funds into Ark'}
            </button>
            {boardSuccess && <p className="field-hint">Boarding started ✓ — will be spendable after 6 confirmations</p>}
            {boardError && <p className="alert-error">{boardError}</p>}
          </div>
          <div className="stack">
            <p className="field-hint">
              <strong>Receive via Lightning</strong> — Ark's own headline
              feature: generate an invoice, and whoever pays it can settle
              at any time. The funds land in this wallet next time it's
              online — no channel to open or manage.
            </p>
            {lnInvoice ? (
              <div className="stack">
                <p className="field-hint" style={{ wordBreak: 'break-all' }}>
                  {lnInvoice.invoice}
                </p>
                <div className="btn-row">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopyInvoice}>
                    {lnInvoiceCopied ? 'Copied' : 'Copy invoice'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleCheckReceive}
                    disabled={checkingReceive}
                  >
                    {checkingReceive ? 'Checking…' : 'Check payment status'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleNewInvoice}>
                    New invoice
                  </button>
                </div>
                {lnReceiveState && (
                  <p className="field-hint">
                    Status: <strong>{lnReceiveState}</strong>
                  </p>
                )}
              </div>
            ) : (
              <div className="stack">
                <input
                  className="input"
                  value={lnAmount}
                  onChange={(e) => setLnAmount(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="Amount (test sats)"
                  inputMode="numeric"
                  disabled={creatingInvoice}
                />
                <input
                  className="input"
                  value={lnDescription}
                  onChange={(e) => setLnDescription(e.target.value)}
                  placeholder="Description (optional)"
                  disabled={creatingInvoice}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleCreateInvoice}
                  disabled={creatingInvoice || !lnAmount}
                >
                  {creatingInvoice ? 'Creating…' : 'Create Lightning invoice'}
                </button>
              </div>
            )}
            {lnError && <p className="alert-error">{lnError}</p>}
          </div>
          <div className="stack">
            <p className="field-hint">
              <strong>Pay via Lightning</strong> — paste an invoice
              (from a real Signet-capable wallet), pay it straight from
              this Ark balance. No channel to open — the Ark server
              handles the actual Lightning routing.
            </p>
            <input
              className="input"
              value={lnPayInvoice}
              onChange={(e) => setLnPayInvoice(e.target.value)}
              placeholder="lntbs1..."
              disabled={paying}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handlePayInvoice}
              disabled={paying || !lnPayInvoice.trim()}
            >
              {paying ? 'Paying…' : 'Pay invoice'}
            </button>
            {payResult && (
              <p className="field-hint">
                {payResult.type === 'paid'
                  ? `Paid ✓ — preimage ${payResult.preimage.slice(0, 16)}…`
                  : payResult.type === 'inProgress'
                    ? `Still in progress — ${payResult.send.amountSats} sats, fee ${payResult.send.feeSats} sats`
                    : 'Status unknown — check your balance to confirm'}
              </p>
            )}
            {payError && <p className="alert-error">{payError}</p>}
          </div>
          <div className="stack">
            <p className="field-hint">
              Send to another Ark (Signet) address — instant, off-chain.
            </p>
            <input
              className="input"
              value={sendAddress}
              onChange={(e) => setSendAddress(e.target.value)}
              placeholder="tark1..."
              disabled={sending}
            />
            <div className="field-row">
              <input
                className="input"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Amount (test sats)"
                inputMode="numeric"
                disabled={sending}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleSend}
                disabled={sending || !sendAddress.trim() || !sendAmount}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
            {sendSuccess && <p className="field-hint">Sent ✓</p>}
            {sendError && <p className="alert-error">{sendError}</p>}
          </div>
          {confirmingForget ? (
            <div className="stack">
              <p className="alert-error">
                No way back once this is gone — this only makes sense if
                you never saved the seed phrase. Confirm?
              </p>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={handleForget}
                  disabled={forgetting}
                >
                  {forgetting ? 'Forgetting…' : 'Yes, forget it'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setConfirmingForget(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setConfirmingForget(true)}
              title="Wipes this wallet from this browser and lets you create a fresh one — only makes sense if you never saved its seed phrase"
            >
              Forget this wallet
            </button>
          )}
        </div>
      ) : status === 'opening' || (hasStoredWallet && status === 'none') ? (
        <p className="field-hint">Opening wallet…</p>
      ) : (
        <div className="stack">
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
