import { useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { createZapInvoice } from '../lib/zap'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { useZapTotal } from '../hooks/useZapTotal'

type State = 'idle' | 'open' | 'fetching' | 'invoice' | 'paying' | 'paid' | 'error'

export function ZapButton({ event }: { event: NDKEvent }) {
  const total = useZapTotal(event.id)
  const [state, setState] = useState<State>('idle')
  const [amount, setAmount] = useState('21')
  const [invoice, setInvoice] = useState('')
  const [error, setError] = useState('')

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

  if (state === 'idle') {
    return (
      <button type="button" onClick={() => setState('open')}>
        ⚡ {total > 0 ? `${total} sats` : 'Zap'}
      </button>
    )
  }

  const showInvoice =
    state === 'invoice' || state === 'paying' || state === 'paid'

  return (
    <div>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="sats"
        inputMode="numeric"
      />
      <button
        type="button"
        onClick={handleGetInvoice}
        disabled={state === 'fetching'}
      >
        {state === 'fetching' ? 'Fetching…' : 'Get invoice'}
      </button>
      <button type="button" onClick={() => setState('idle')}>
        Cancel
      </button>

      {showInvoice && (
        <div>
          <textarea readOnly value={invoice} rows={3} />
          <button type="button" onClick={handleCopyInvoice}>
            Copy invoice
          </button>
          {getSavedNwcUri() && (
            <button
              type="button"
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
      )}

      {error && <p role="alert">{error}</p>}
    </div>
  )
}
