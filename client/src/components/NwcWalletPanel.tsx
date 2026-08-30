import { useEffect, useState } from 'react'
import {
  createInvoiceWithNwc,
  getSavedNwcUri,
  getWalletBalanceMsat,
  getWalletInfo,
  listTransactionsWithNwc,
  lookupInvoiceWithNwc,
  parseNwcUri,
  payInvoiceWithNwc,
  type NwcTransaction,
  type NwcWalletInfo,
} from '../lib/nwc'
import { useActiveUser } from '../hooks/useActiveUser'

function satsFromMsat(msat: number): number {
  return Math.floor(msat / 1000)
}

function formatTxAmount(tx: NwcTransaction): string {
  const sats = satsFromMsat(tx.amount)
  return `${tx.type === 'incoming' ? '+' : '-'}${sats.toLocaleString()} sats`
}

function formatTimestamp(unixSeconds: number | undefined): string {
  if (!unixSeconds) return '—'
  return new Date(unixSeconds * 1000).toLocaleString()
}

// The real, currently-connected wallet's own features — everything in
// this file is scoped to whichever wallet Settings > NWC Wallet has
// connected for the active identity. Only pay_invoice/make_invoice
// (both real money movement, one spending, one creating a payable
// request) are ever gated behind an explicit button click, matching
// this project's standing financial-safety rule; every read-only
// method here (get_balance/get_info/list_transactions/lookup_invoice)
// is safe to call on mount or on a plain refresh click, exactly like
// the Ark wallet's own "Sync" buttons.
export function NwcWalletPanel() {
  useActiveUser()
  const uri = getSavedNwcUri()

  const [balanceMsat, setBalanceMsat] = useState<number | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(false)

  const [info, setInfo] = useState<NwcWalletInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)

  const [transactions, setTransactions] = useState<NwcTransaction[] | null>(null)
  const [txError, setTxError] = useState<string | null>(null)
  const [loadingTx, setLoadingTx] = useState(false)
  const [txOffset, setTxOffset] = useState(0)
  const TX_PAGE_SIZE = 10

  const [lookupInput, setLookupInput] = useState('')
  const [lookupResult, setLookupResult] = useState<NwcTransaction | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookingUp, setLookingUp] = useState(false)

  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceDescription, setInvoiceDescription] = useState('')
  const [createdInvoice, setCreatedInvoice] = useState<NwcTransaction | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingInvoice, setCreatingInvoice] = useState(false)
  const [invoiceCopied, setInvoiceCopied] = useState(false)

  const [payInvoiceInput, setPayInvoiceInput] = useState('')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [paySuccess, setPaySuccess] = useState(false)

  async function loadBalance() {
    if (!uri) return
    setLoadingBalance(true)
    setBalanceError(null)
    try {
      setBalanceMsat(await getWalletBalanceMsat(uri))
    } catch (e) {
      setBalanceError(e instanceof Error ? e.message : 'Balance unavailable')
    } finally {
      setLoadingBalance(false)
    }
  }

  async function loadInfo() {
    if (!uri) return
    setLoadingInfo(true)
    setInfoError(null)
    try {
      setInfo(await getWalletInfo(uri))
    } catch (e) {
      setInfoError(e instanceof Error ? e.message : 'Node info unavailable')
    } finally {
      setLoadingInfo(false)
    }
  }

  async function loadTransactions(offset: number) {
    if (!uri) return
    setLoadingTx(true)
    setTxError(null)
    try {
      const txs = await listTransactionsWithNwc(uri, { limit: TX_PAGE_SIZE, offset })
      setTransactions(txs)
      setTxOffset(offset)
    } catch (e) {
      setTxError(e instanceof Error ? e.message : 'Transaction history unavailable')
    } finally {
      setLoadingTx(false)
    }
  }

  // Fetches once per connected wallet — re-fires if the identity (and
  // so the underlying NWC connection) changes, same reasoning as
  // useWalletBalance.ts's own effect.
  useEffect(() => {
    if (!uri) return
    loadBalance()
    loadInfo()
    loadTransactions(0)
  }, [uri])

  async function handleLookup() {
    if (!uri || !lookupInput.trim()) return
    setLookingUp(true)
    setLookupError(null)
    setLookupResult(null)
    try {
      const trimmed = lookupInput.trim()
      // A bolt11 invoice always starts with "ln" (lnbc/lntb/lntbs/lnbcrt);
      // anything else is treated as a payment_hash, matching lookup_invoice's
      // own "either... or..." shape.
      const args = trimmed.toLowerCase().startsWith('ln') ? { invoice: trimmed } : { paymentHash: trimmed }
      setLookupResult(await lookupInvoiceWithNwc(uri, args))
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLookingUp(false)
    }
  }

  async function handleCreateInvoice() {
    if (!uri) return
    const sats = Number.parseInt(invoiceAmount, 10)
    if (!Number.isFinite(sats) || sats <= 0) return
    setCreatingInvoice(true)
    setCreateError(null)
    setCreatedInvoice(null)
    try {
      const result = await createInvoiceWithNwc(uri, {
        amountMsat: sats * 1000,
        description: invoiceDescription.trim() || undefined,
      })
      setCreatedInvoice(result)
      setInvoiceAmount('')
      setInvoiceDescription('')
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create invoice')
    } finally {
      setCreatingInvoice(false)
    }
  }

  function handleCopyInvoice() {
    if (!createdInvoice?.invoice) return
    navigator.clipboard.writeText(createdInvoice.invoice)
    setInvoiceCopied(true)
    setTimeout(() => setInvoiceCopied(false), 1500)
  }

  // Real money movement — only ever runs from this explicit button
  // click, never automatically, matching this project's standing rule
  // (see payInvoiceWithNwc's own doc comment in lib/nwc.ts).
  async function handlePay() {
    if (!uri || !payInvoiceInput.trim()) return
    setPaying(true)
    setPayError(null)
    setPaySuccess(false)
    try {
      await payInvoiceWithNwc(uri, payInvoiceInput.trim())
      setPayInvoiceInput('')
      setPaySuccess(true)
      loadBalance()
      loadTransactions(0)
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  if (!uri) return null

  let connectionLabel = 'Connected wallet'
  try {
    const { relay } = parseNwcUri(uri)
    connectionLabel = `Connected via ${new URL(relay).host}`
  } catch {
    // Malformed URI would already have surfaced via NwcConnect in
    // Settings — fall back to the generic label rather than crash here.
  }

  return (
    <div className="stack">
      <p className="field-hint">{connectionLabel}</p>

      <div className="stack">
        <div className="field-row" style={{ alignItems: 'center' }}>
          <p className="field-hint" style={{ flex: 1 }}>
            <strong>Balance:</strong>{' '}
            {balanceMsat !== null ? `${satsFromMsat(balanceMsat).toLocaleString()} sats` : '—'}
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadBalance} disabled={loadingBalance}>
            {loadingBalance ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {balanceError && <p className="alert-error">{balanceError}</p>}
      </div>

      <div className="stack">
        <div className="field-row" style={{ alignItems: 'center' }}>
          <p className="field-hint" style={{ flex: 1 }}>
            <strong>Node info</strong>
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadInfo} disabled={loadingInfo}>
            {loadingInfo ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {info && (
          <p className="field-hint">
            {info.alias || 'Unnamed node'} — {info.network}, block {info.block_height.toLocaleString()}
            {info.methods.length > 0 && <> — supports: {info.methods.join(', ')}</>}
          </p>
        )}
        {infoError && <p className="alert-error">{infoError}</p>}
      </div>

      <div className="stack">
        <p className="field-hint">
          <strong>Send a payment</strong> — paste any real invoice and pay it directly from this
          wallet.
        </p>
        <input
          className="input"
          value={payInvoiceInput}
          onChange={(e) => setPayInvoiceInput(e.target.value)}
          placeholder="lnbc1..."
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handlePay}
          disabled={paying || !payInvoiceInput.trim()}
        >
          {paying ? 'Paying…' : 'Pay invoice'}
        </button>
        {paySuccess && <p className="field-hint">Paid ✓</p>}
        {payError && <p className="alert-error">{payError}</p>}
      </div>

      <div className="stack">
        <p className="field-hint">
          <strong>Create an invoice</strong> — request a real payment to this wallet.
        </p>
        <input
          className="input"
          value={invoiceAmount}
          onChange={(e) => setInvoiceAmount(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="Amount (sats)"
        />
        <input
          className="input"
          value={invoiceDescription}
          onChange={(e) => setInvoiceDescription(e.target.value)}
          placeholder="Description (optional)"
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleCreateInvoice}
          disabled={creatingInvoice || !invoiceAmount}
        >
          {creatingInvoice ? 'Creating…' : 'Create invoice'}
        </button>
        {createdInvoice?.invoice && (
          <div className="stack">
            <p className="field-hint" style={{ wordBreak: 'break-all' }}>
              {createdInvoice.invoice}
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopyInvoice}>
              {invoiceCopied ? 'Copied' : 'Copy invoice'}
            </button>
          </div>
        )}
        {createError && <p className="alert-error">{createError}</p>}
      </div>

      <div className="stack">
        <p className="field-hint">
          <strong>Look up an invoice</strong> — paste a payment hash or a bolt11 invoice to check
          its status.
        </p>
        <input
          className="input"
          value={lookupInput}
          onChange={(e) => setLookupInput(e.target.value)}
          placeholder="Payment hash or lnbc1..."
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleLookup}
          disabled={lookingUp || !lookupInput.trim()}
        >
          {lookingUp ? 'Looking up…' : 'Look up'}
        </button>
        {lookupResult && (
          <p className="field-hint">
            {lookupResult.type} — {formatTxAmount(lookupResult)}
            {lookupResult.settled_at
              ? ` — settled ${formatTimestamp(lookupResult.settled_at)}`
              : ' — not yet settled'}
          </p>
        )}
        {lookupError && <p className="alert-error">{lookupError}</p>}
      </div>

      <div className="stack">
        <div className="field-row" style={{ alignItems: 'center' }}>
          <p className="field-hint" style={{ flex: 1 }}>
            <strong>Transaction history</strong>
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => loadTransactions(0)}
            disabled={loadingTx}
          >
            {loadingTx ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {transactions && transactions.length === 0 && txOffset === 0 && (
          <p className="field-hint">No transactions yet.</p>
        )}
        {transactions && transactions.length > 0 && (
          <div className="stack">
            {transactions.map((tx) => (
              <div key={tx.payment_hash} className="field-row" style={{ alignItems: 'center' }}>
                <p className="field-hint" style={{ flex: 1 }}>
                  {tx.description || (tx.type === 'incoming' ? 'Received' : 'Sent')} —{' '}
                  {formatTimestamp(tx.settled_at ?? tx.created_at)}
                </p>
                <p className="field-hint">{formatTxAmount(tx)}</p>
              </div>
            ))}
          </div>
        )}
        <div className="btn-row">
          {txOffset > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => loadTransactions(Math.max(0, txOffset - TX_PAGE_SIZE))}
              disabled={loadingTx}
            >
              Newer
            </button>
          )}
          {transactions && transactions.length === TX_PAGE_SIZE && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => loadTransactions(txOffset + TX_PAGE_SIZE)}
              disabled={loadingTx}
            >
              Older
            </button>
          )}
        </div>
        {txError && <p className="alert-error">{txError}</p>}
      </div>
    </div>
  )
}
