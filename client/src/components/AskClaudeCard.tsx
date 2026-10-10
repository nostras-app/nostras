import { useEffect, useRef, useState } from 'react'
import {
  requestDvmJob,
  getPreferredDvmModel,
  setPreferredDvmModel,
  type DvmJobUpdate,
  type DvmModel,
} from '../lib/dvm'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { useDvmModels } from '../hooks/useDvmModels'

const KIND_JOB_REQUEST_GENERATE = 5050
const KIND_JOB_RESULT_GENERATE = 6050

const BACKEND_NAMES: Record<string, string> = { anthropic: 'Anthropic' }

// What the chosen model means for who can see the user's text. The DVM
// itself always decrypts the job to run it; this is about where it goes
// next.
function privacyNote(m: DvmModel): string {
  if (m.privacy === 'local') {
    return 'Runs on the DVM operator’s own hardware. Your question isn’t sent to any AI company.'
  }
  if (m.privacy === 'confidential') {
    return 'Runs in confidential compute: the provider can’t read your question.'
  }
  const provider = BACKEND_NAMES[m.backend] ?? 'the model provider'
  return `Sent to ${provider}, which can see your question under its own data policy.`
}

function privacyLabel(m: DvmModel): string {
  if (m.privacy === 'local') return 'local'
  if (m.privacy === 'confidential') return 'confidential'
  return BACKEND_NAMES[m.backend] ?? 'third-party'
}

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
  const { models } = useDvmModels()
  const [preferred, setPreferred] = useState<string | null>(() => getPreferredDvmModel())

  // The model that will actually run: the saved choice if the DVM still
  // offers it, otherwise the DVM's default.
  const selected =
    models.find((m) => m.id === preferred) ?? models.find((m) => m.default) ?? models[0]

  function handlePickModel(id: string) {
    const isDefault = models.find((m) => m.id === id)?.default
    // Store nothing for the default, so a future default change applies.
    setPreferredDvmModel(isDefault ? null : id)
    setPreferred(isDefault ? null : id)
  }

  useEffect(() => () => cancelRef.current?.(), [])

  function handleAsk() {
    if (!prompt.trim() || state === 'requesting') return
    setState('requesting')
    setAnswer('')
    setError('')
    cancelRef.current = requestDvmJob({
      requestKind: KIND_JOB_REQUEST_GENERATE,
      resultKind: KIND_JOB_RESULT_GENERATE,
      encrypt: true,
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
          Powered by a NIP-90 Data Vending Machine: an AI worker that takes
          jobs over Nostr and gets paid in sats, per question. Your question
          and the answer are encrypted between you and the DVM. No account,
          no subscription. Job doesn't finish, you don't pay.
        </p>
        <textarea
          className="textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask anything…"
          rows={3}
          disabled={busy}
        />
        {models.length > 1 && (
          <label className="ask-claude-model-picker">
            <span className="field-hint">Model</span>
            <select
              className="input"
              value={selected?.id ?? ''}
              onChange={(e) => handlePickModel(e.target.value)}
              disabled={busy}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} ({privacyLabel(m)})
                </option>
              ))}
            </select>
          </label>
        )}
        {selected && (
          <p className="field-hint ask-claude-model">
            {models.length <= 1 && <>Model: {selected.id}. </>}
            {privacyNote(selected)}
            {models.length > 1 && ' Also used for translate, summarize and spam check.'}
          </p>
        )}

        {(state === 'idle' || state === 'requesting') && (
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-anthropic"
              onClick={handleAsk}
              disabled={!prompt.trim() || state === 'requesting'}
            >
              {state === 'requesting' ? 'Asking…' : 'Ask AI'}
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
