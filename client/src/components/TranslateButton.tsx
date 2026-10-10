import { useEffect, useRef, useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { requestDvmJob, type DvmJobUpdate } from '../lib/dvm'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { GlobeIcon } from './icons'

const KIND_JOB_REQUEST_TRANSLATE = 5002
const KIND_JOB_RESULT_TRANSLATE = 6002

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
]

type State = 'idle' | 'picking' | 'requesting' | 'payment-required' | 'done' | 'error'

export function TranslateButton({ event }: { event: NDKEvent }) {
  const [state, setState] = useState<State>('idle')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState('')
  const [amountSats, setAmountSats] = useState(0)
  const [paying, setPaying] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cancelRef.current?.(), [])

  function handlePick(langCode: string) {
    setState('requesting')
    cancelRef.current = requestDvmJob({
      requestKind: KIND_JOB_REQUEST_TRANSLATE,
      resultKind: KIND_JOB_RESULT_TRANSLATE,
      encrypt: true,
      inputText: event.content,
      params: [['language', langCode]],
      onUpdate: (update: DvmJobUpdate) => {
        if (update.status === 'processing') {
          setState('requesting')
        } else if (update.status === 'payment-required') {
          setInvoice(update.invoice)
          setAmountSats(Math.round(update.amountMsat / 1000))
          setState('payment-required')
        } else if (update.status === 'done') {
          setResult(update.result)
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
      // The DVM publishes "processing" once it observes settlement, then
      // the result — onUpdate above will move us out of this state.
      setState('requesting')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
      setState('error')
    } finally {
      setPaying(false)
    }
  }

  function handleClose() {
    cancelRef.current?.()
    cancelRef.current = null
    setState('idle')
    setResult('')
    setError('')
    setInvoice('')
  }

  if (state === 'idle') {
    return (
      <button
        type="button"
        className="engage-btn engage-btn-translate"
        onClick={() => setState('picking')}
        title="Translate"
      >
        <GlobeIcon />
      </button>
    )
  }

  return (
    <div className="translate-panel">
      {state === 'picking' && (
        <>
          <span className="translate-panel-label">Translate to…</span>
          <div className="language-grid">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handlePick(lang.code)}
              >
                {lang.label}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleClose}>
              Cancel
            </button>
          </div>
        </>
      )}

      {state === 'requesting' && <p className="field-hint">Translating…</p>}

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
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleClose}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state === 'done' && (
        <div className="stack">
          <p className="feed-item-content">{result}</p>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleClose}>
              Close
            </button>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="stack">
          <p className="alert-error">{error}</p>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
