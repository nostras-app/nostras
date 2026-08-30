import { useEffect, useState } from 'react'
import type { ExitVtxo, LightningSendStatus, PendingBoard } from '@secondts/bark/web'
import {
  boardAllFunds,
  cancelWalletExit,
  checkLightningReceive,
  createArkWallet,
  createLightningInvoice,
  estimateBoardFee,
  getMinBoardAmountSats,
  forgetArkWallet,
  getExitSummary,
  listPendingBoards,
  loadArkMnemonic,
  payLightningInvoiceViaArk,
  progressWalletExits,
  rescanOnchainWallet,
  sendArkPayment,
  startWalletExit,
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
  const [exitSummary, setExitSummary] = useState<{
    hasPending: boolean
    pendingSats: number
    vtxos: ExitVtxo[]
  } | null>(null)
  const [checkingExit, setCheckingExit] = useState(false)
  const [confirmingExit, setConfirmingExit] = useState(false)
  const [startingExit, setStartingExit] = useState(false)
  const [progressingExit, setProgressingExit] = useState(false)
  const [cancelingVtxoId, setCancelingVtxoId] = useState<string | null>(null)
  const [exitError, setExitError] = useState<string | null>(null)
  const [boardFeeEstimate, setBoardFeeEstimate] = useState<{ feeSats: number; netAmountSats: number } | null>(
    null,
  )
  const [belowMinBoardSats, setBelowMinBoardSats] = useState<number | null>(null)
  const [pendingBoards, setPendingBoards] = useState<PendingBoard[] | null>(null)
  const [checkingPendingBoards, setCheckingPendingBoards] = useState(false)
  const [pendingBoardsError, setPendingBoardsError] = useState<string | null>(null)
  const [boardFeeError, setBoardFeeError] = useState<string | null>(null)

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

  // Fetches a real fee estimate whenever the on-chain balance changes,
  // so "not enough to cover fees yet" shows up as a clear warning
  // before Board is clicked, not just as a failed attempt after —
  // real gap hit live: a 1000-sat balance failed boarding with
  // "Insufficient funds: 0.00001000 BTC available of 0.00004098 BTC
  // needed" (amount + real on-chain + Ark board fees, not a bug).
  useEffect(() => {
    setBoardFeeEstimate(null)
    setBelowMinBoardSats(null)
    setBoardFeeError(null)
    if (!onchainBalanceSats) return
    let cancelled = false
    // Real minimum board amount checked first, via the Ark server's own
    // reported value — a separate, harder floor from fee coverage (a
    // balance can clear fees and still be below this). Only estimate
    // the fee once the balance actually clears it, since the fee
    // estimate call itself doesn't reflect this floor.
    getMinBoardAmountSats()
      .then((minSats) => {
        if (cancelled) return
        if (onchainBalanceSats < minSats) {
          setBelowMinBoardSats(minSats)
          return
        }
        return estimateBoardFee(onchainBalanceSats).then((estimate) => {
          if (!cancelled) setBoardFeeEstimate(estimate)
        })
      })
      .catch((e) => {
        if (!cancelled) setBoardFeeError(e instanceof Error ? e.message : 'Could not estimate fee')
      })
    return () => {
      cancelled = true
    }
  }, [onchainBalanceSats])

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
      await handleCheckPendingBoards()
    } catch (e) {
      setBoardError(e instanceof Error ? e.message : 'Boarding failed')
    }
  }

  async function handleCheckPendingBoards() {
    setCheckingPendingBoards(true)
    setPendingBoardsError(null)
    try {
      const boards = await listPendingBoards()
      setPendingBoards(boards)
    } catch (e) {
      setPendingBoardsError(e instanceof Error ? e.message : 'Could not check pending boards')
    } finally {
      setCheckingPendingBoards(false)
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

  async function handleCheckExitStatus() {
    setCheckingExit(true)
    setExitError(null)
    try {
      const summary = await getExitSummary()
      setExitSummary(summary)
    } catch (e) {
      setExitError(e instanceof Error ? e.message : 'Could not check exit status')
    } finally {
      setCheckingExit(false)
    }
  }

  async function handleStartExit() {
    setStartingExit(true)
    setExitError(null)
    try {
      await startWalletExit()
      setConfirmingExit(false)
      await handleCheckExitStatus()
    } catch (e) {
      setExitError(e instanceof Error ? e.message : 'Could not start exit')
    } finally {
      setStartingExit(false)
    }
  }

  async function handleProgressExit() {
    setProgressingExit(true)
    setExitError(null)
    try {
      await progressWalletExits()
      await handleCheckExitStatus()
    } catch (e) {
      setExitError(e instanceof Error ? e.message : 'Could not progress exit')
    } finally {
      setProgressingExit(false)
    }
  }

  async function handleCancelExit(vtxoId: string) {
    setCancelingVtxoId(vtxoId)
    setExitError(null)
    try {
      const result = await cancelWalletExit(vtxoId)
      if (!result.canceled) {
        const reason = result.reason
        setExitError(
          reason?.type === 'too-late'
            ? `Too late to cancel — already at state: ${reason.state}`
            : reason?.type === 'already-broadcast'
              ? `Too late to cancel — already broadcast (txid ${reason.txid.slice(0, 12)}…)`
              : 'Could not cancel — this VTXO is not currently exiting',
        )
      }
      await handleCheckExitStatus()
    } catch (e) {
      setExitError(e instanceof Error ? e.message : 'Could not cancel exit')
    } finally {
      setCancelingVtxoId(null)
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
              Ark. Get free Signet coins from{' '}
              <a href="https://bitcoinsignetfaucet.com" target="_blank" rel="noreferrer">
                bitcoinsignetfaucet.com
              </a>{' '}
              or{' '}
              <a href="https://alt.signetfaucet.com" target="_blank" rel="noreferrer">
                alt.signetfaucet.com
              </a>{' '}
              (both live and independently confirmed as of 2026-08-30 —
              the faucet previously linked here, mempool.space/signet/
              faucet, no longer exists; it now just redirects to
              mempool's plain homepage). Boarded funds need 6 real
              on-chain confirmations before they're spendable in Ark.
              <strong> Only ever use real Signet coins here, never real
              mainnet bitcoin</strong> — the two networks don't connect,
              and nothing sent to the wrong one comes back through this
              wallet.
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
            <p className="field-hint">
              Funded an address but the balance stays 0 after syncing?
              "Sync" only checks addresses this wallet already has in
              memory — if the page reloaded between generating the
              address and funding it, use this instead:
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => rescanOnchainWallet()}
              disabled={onchainSyncing}
            >
              {onchainSyncing ? 'Scanning…' : 'Rescan on-chain history'}
            </button>
            {belowMinBoardSats !== null && (
              <p className="alert-error">
                The Ark server requires at least <strong>{belowMinBoardSats} sats</strong> to
                board — this on-chain balance ({onchainBalanceSats} sats) is below that.
                Request more from the faucet before trying to board.
              </p>
            )}
            {boardFeeEstimate &&
              (boardFeeEstimate.netAmountSats > 0 ? (
                <p className="field-hint">
                  Estimated fee: <strong>{boardFeeEstimate.feeSats} sats</strong> — you'd board{' '}
                  <strong>{boardFeeEstimate.netAmountSats} sats</strong> net.
                </p>
              ) : (
                <p className="alert-error">
                  Not enough to cover boarding fees yet — this balance doesn't clear the fee
                  floor. Request more from the faucet before trying to board.
                </p>
              ))}
            {boardFeeError && <p className="alert-error">{boardFeeError}</p>}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleBoardAll}
              disabled={
                boarding ||
                !onchainBalanceSats ||
                !!boardFeeError ||
                belowMinBoardSats !== null ||
                (boardFeeEstimate ? boardFeeEstimate.netAmountSats <= 0 : false)
              }
            >
              {boarding ? 'Boarding…' : 'Board all on-chain funds into Ark'}
            </button>
            {boardSuccess && <p className="field-hint">Boarding started ✓ — will be spendable after 6 confirmations</p>}
            {boardError && <p className="alert-error">{boardError}</p>}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleCheckPendingBoards}
              disabled={checkingPendingBoards}
            >
              {checkingPendingBoards ? 'Checking…' : 'Check pending boards'}
            </button>
            {pendingBoards && pendingBoards.length === 0 && (
              <p className="field-hint">No boards currently pending.</p>
            )}
            {pendingBoards && pendingBoards.length > 0 && (
              <div className="stack">
                {pendingBoards.map((b) => (
                  <p key={b.vtxoId} className="field-hint">
                    Pending: <strong>{b.amountSats} sats</strong> — waiting on confirmations,
                    not spendable in Ark yet —{' '}
                    <a
                      href={`https://mempool.space/signet/tx/${b.txid}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      view on explorer
                    </a>
                  </p>
                ))}
              </div>
            )}
            {pendingBoardsError && <p className="alert-error">{pendingBoardsError}</p>}
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
          <div className="stack">
            <p className="field-hint">
              <strong>Emergency exit</strong> — the real safety mechanism
              behind this whole wallet. Only for if the Ark server ever
              disappears or misbehaves: every VTXO carries a genuine
              on-chain fallback, secured by real Bitcoin timelocks, that
              needs no server cooperation. Starting one broadcasts your
              pre-signed exit transactions; a ~144-block wait (real
              on-chain time) follows before they're claimable. Claiming
              the exited funds into a spendable balance isn't built yet
              — this only starts, monitors, and (while still possible)
              cancels an exit.
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleCheckExitStatus}
              disabled={checkingExit}
            >
              {checkingExit ? 'Checking…' : 'Check exit status'}
            </button>
            {exitSummary && (
              <div className="stack">
                <p className="field-hint">
                  {exitSummary.hasPending
                    ? `Pending exit: ${exitSummary.pendingSats} test sats`
                    : 'No exit in progress'}
                </p>
                {exitSummary.vtxos.map((v) => (
                  <div key={v.vtxoId} className="field-row" style={{ alignItems: 'center' }}>
                    <p className="field-hint" style={{ flex: 1, wordBreak: 'break-all' }}>
                      {v.vtxoId.slice(0, 16)}… — {v.amountSats} sats — {v.state.type}
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleCancelExit(v.vtxoId)}
                      disabled={cancelingVtxoId === v.vtxoId}
                    >
                      {cancelingVtxoId === v.vtxoId ? 'Canceling…' : 'Cancel'}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleProgressExit}
              disabled={progressingExit}
            >
              {progressingExit ? 'Progressing…' : 'Progress exit'}
            </button>
            {confirmingExit ? (
              <div className="stack">
                <p className="alert-error">
                  This broadcasts real (Signet) transactions and starts
                  exiting every VTXO in this wallet. Confirm?
                </p>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={handleStartExit}
                    disabled={startingExit}
                  >
                    {startingExit ? 'Starting…' : 'Yes, start emergency exit'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setConfirmingExit(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmingExit(true)}
              >
                Start emergency exit (entire wallet)
              </button>
            )}
            {exitError && <p className="alert-error">{exitError}</p>}
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
