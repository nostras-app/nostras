import { useState } from 'react'
import { publishPoll } from '../lib/poll'

const DURATION_OPTIONS = [
  { label: '1 hour', seconds: 60 * 60 },
  { label: '24 hours', seconds: 24 * 60 * 60 },
  { label: '3 days', seconds: 3 * 24 * 60 * 60 },
  { label: '1 week', seconds: 7 * 24 * 60 * 60 },
] as const

const MIN_OPTIONS = 2
const MAX_OPTIONS = 8

// NIP-88 poll composer. Kept to the two required choices the spec
// actually needs — question + options, single/multi choice, and an end
// time (required by the spec, unlike NIP-38's optional expiration) — no
// per-option images or anything else beyond the core spec shape.
export function PollComposer() {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [polltype, setPolltype] = useState<'singlechoice' | 'multiplechoice'>('singlechoice')
  const [duration, setDuration] = useState<number>(DURATION_OPTIONS[1].seconds)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)))
  }

  function addOption() {
    if (options.length >= MAX_OPTIONS) return
    setOptions((prev) => [...prev, ''])
  }

  function removeOption(index: number) {
    if (options.length <= MIN_OPTIONS) return
    setOptions((prev) => prev.filter((_, i) => i !== index))
  }

  const validOptions = options.map((o) => o.trim()).filter(Boolean)
  const canPublish = question.trim().length > 0 && validOptions.length >= MIN_OPTIONS && !publishing

  async function handlePublish() {
    if (!canPublish) return
    setPublishing(true)
    setError(null)
    try {
      await publishPoll(question.trim(), validOptions, polltype, duration)
      setQuestion('')
      setOptions(['', ''])
      setPolltype('singlechoice')
      setDuration(DURATION_OPTIONS[1].seconds)
      setPublished(true)
      setTimeout(() => setPublished(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish poll')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="article-composer">
      <input
        className="input"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask a question…"
      />

      <div className="stack">
        {options.map((opt, i) => (
          <div key={i} className="field-row">
            <input
              className="input"
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
            />
            {options.length > MIN_OPTIONS && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeOption(i)}>
                ×
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={addOption}>
            + Add option
          </button>
        )}
      </div>

      <div className="field-row">
        <label>
          <input
            type="radio"
            checked={polltype === 'singlechoice'}
            onChange={() => setPolltype('singlechoice')}
          />
          Single choice
        </label>
        <label>
          <input
            type="radio"
            checked={polltype === 'multiplechoice'}
            onChange={() => setPolltype('multiplechoice')}
          />
          Multiple choice
        </label>
      </div>

      <div className="field-row">
        <span className="field-hint">Ends in:</span>
        {DURATION_OPTIONS.map((d) => (
          <button
            key={d.seconds}
            type="button"
            className={`btn btn-sm ${duration === d.seconds ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setDuration(d.seconds)}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="btn-row">
        {published && <span className="field-hint">Published!</span>}
        <button type="button" className="btn btn-primary" onClick={handlePublish} disabled={!canPublish}>
          {publishing ? 'Publishing…' : 'Publish poll'}
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
