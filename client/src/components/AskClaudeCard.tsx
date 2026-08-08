import { useEffect, useRef, useState } from 'react'
import { requestDvmJob, type DvmJobUpdate } from '../lib/dvm'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'

const KIND_JOB_REQUEST_GENERATE = 5050
const KIND_JOB_RESULT_GENERATE = 6050

// Must match dvmModel in server/cmd/dvm/main.go — purely a display label
// here, the server alone decides which model it actually calls.
const DVM_MODEL = 'claude-opus-5'

type State = 'idle' | 'requesting' | 'payment-required' | 'done' | 'error'

export function AskClaudeCard() {
  const [prompt, setPrompt] = useState('')
  const [state, setState] = useState<State>('idle')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState('')
  const [amountSats, setAmountSats] = useState(0)
  const [paying, setPaying] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cancelRef.current?.(), [])

  function handleAsk() {
    if (!prompt.trim() || state === 'requesting') return
    setState('requesting')
    setAnswer('')
    setError('')
    cancelRef.current = requestDvmJob({
      requestKind: KIND_JOB_REQUEST_GENERATE,
      resultKind: KIND_JOB_RESULT_GENERATE,
      inputText: prompt,
      onUpdate: (update: DvmJobUpdate) => {
        if (update.status === 'processing') {
          setState('requesting')
        } else if (update.status === 'payment-required') {
          setInvoice(update.invoice)
          setAmountSats(Math.round(update.amountMsat / 1000))
          setState('payment-required')
        } else if (update.status === 'done') {
          setAnswer(update.result)
          setState('done')
        } else if (update.status === 'error') {
          setError(update.message)
          setState('error')
        }
      },
    })
  }

  async function handlePayWithWallet() {
    const nwcUri = getSavedNwcUri()
    if (!nwcUri) return
    setPaying(true)
    try {
      await payInvoiceWithNwc(nwcUri, invoice)
      setState('requesting')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
      setState('error')
    } finally {
      setPaying(false)
    }
  }

  function handleReset() {
    cancelRef.current?.()
    cancelRef.current = null
    setState('idle')
    setPrompt('')
    setAnswer('')
    setError('')
    setInvoice('')
  }

  const busy = state === 'requesting' || state === 'payment-required'

  return (
    <div className="ask-claude">
      <div className="composer-body">
        <p className="field-hint">
          Powered by a NIP-90 Data Vending Machine — a Claude worker that
          takes jobs over Nostr and gets paid in sats, per question. No
          account, no subscription, nothing retained beyond your prompt.
          Job doesn't finish, you don't pay.
        </p>
        <textarea
          className="textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask anything…"
          rows={3}
          disabled={busy}
        />
        <p className="field-hint ask-claude-model">Model: {DVM_MODEL}</p>

        {(state === 'idle' || state === 'requesting') && (
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-anthropic"
              onClick={handleAsk}
              disabled={!prompt.trim() || state === 'requesting'}
            >
              {state === 'requesting' ? 'Asking…' : 'Ask Claude'}
            </button>
          </div>
        )}

        {state === 'payment-required' && (
          <div className="stack">
            <p className="field-hint">
              Payment required to run this job — you are paying{' '}
              <strong>{amountSats} sats</strong>.
            </p>
            <textarea className="textarea" readOnly value={invoice} rows={3} />
            <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => navigator.clipboard.writeText(invoice)}
              >
                Copy invoice
              </button>
              {getSavedNwcUri() && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handlePayWithWallet}
                  disabled={paying}
                >
                  {paying ? 'Paying…' : 'Pay with connected wallet'}
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleReset}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {state === 'done' && (
          <div className="stack">
            <p className="feed-item-content ask-claude-answer">{answer}</p>
            <div className="btn-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleReset}>
                Ask another
              </button>
            </div>
          </div>
        )}

        {state === 'error' && (
          <div className="stack">
            <p className="alert-error">{error}</p>
            <div className="btn-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleReset}>
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
