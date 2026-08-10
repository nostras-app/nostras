import { useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { createZapInvoice } from '../lib/zap'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { useZapList } from '../hooks/useZapTotal'
import { EngagementListModal } from './EngagementListModal'
import { ZapIcon } from './icons'

type State = 'idle' | 'open' | 'fetching' | 'invoice' | 'paying' | 'paid' | 'error'

export function ZapButton({ event }: { event: NDKEvent }) {
  const { total, zaps } = useZapList(event.id)
  const [state, setState] = useState<State>('idle')
  const [amount, setAmount] = useState('21')
  const [invoice, setInvoice] = useState('')
  const [error, setError] = useState('')
  const [listOpen, setListOpen] = useState(false)

  async function handleGetInvoice() {
    const sats = Number(amount)
    if (!sats || sats <= 0) return
    setState('fetching')
    setError('')
    try {
      const inv = await createZapInvoice(event, sats)
      setInvoice(inv)
      setState('invoice')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get invoice')
      setState('error')
    }
  }

  async function handlePayWithWallet() {
    const nwcUri = getSavedNwcUri()
    if (!nwcUri) return
    setState('paying')
    setError('')
    try {
      await payInvoiceWithNwc(nwcUri, invoice)
      setState('paid')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
      setState('error')
    }
  }

  function handleCopyInvoice() {
    navigator.clipboard.writeText(invoice)
  }

  const zapListModal = listOpen && (
    <EngagementListModal
      title="Zapped by"
      entries={zaps.map((z) => ({ pubkey: z.pubkey, meta: `${z.amountSats.toLocaleString()} sats` }))}
      onClose={() => setListOpen(false)}
    />
  )

  if (state === 'idle') {
    return (
      <>
        <span className="engage-btn engage-btn-zap">
          <button
            type="button"
            className="engage-btn-icon"
            onClick={() => setState('open')}
            aria-label="Zap"
          >
            <ZapIcon filled />
          </button>
          {total > 0 && (
            <button
              type="button"
              className="engage-count"
              onClick={() => setListOpen(true)}
              title="See who zapped"
            >
              {total}
            </button>
          )}
        </span>
        {zapListModal}
      </>
    )
  }

  const showInvoice =
    state === 'invoice' || state === 'paying' || state === 'paid'

  return (
    <>
      <div className="zap-panel">
        <div className="zap-amount-row">
          <input
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="sats"
            inputMode="numeric"
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleGetInvoice}
            disabled={state === 'fetching'}
          >
            {state === 'fetching' ? 'Fetching…' : 'Get invoice'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setState('idle')}
          >
            Cancel
          </button>
        </div>

        {showInvoice && (
          <div className="stack">
            <textarea className="textarea" readOnly value={invoice} rows={3} />
            <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleCopyInvoice}
              >
                Copy invoice
              </button>
              {getSavedNwcUri() && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handlePayWithWallet}
                  disabled={state === 'paying' || state === 'paid'}
                >
                  {state === 'paid'
                    ? 'Paid ✓'
                    : state === 'paying'
                      ? 'Paying…'
                      : 'Pay with connected wallet'}
                </button>
              )}
            </div>
          </div>
        )}

        {error && <p className="alert-error">{error}</p>}
      </div>
      {zapListModal}
    </>
  )
}
