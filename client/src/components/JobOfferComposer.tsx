import { useState } from 'react'
import { publishJobOffer } from '../lib/job'

// Job board offer composer. Reward payment only supports sats/btc/usd —
// see server/cmd/dvm/main.go's listingPriceSats (reused as-is for job
// rewards) — so the currency select is deliberately limited to those
// three rather than a free-text field, so a poster can't accidentally
// publish a job the completion-payment job will always reject.
const CURRENCIES = ['sats', 'usd', 'btc'] as const

export function JobOfferComposer() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [rewardCurrency, setRewardCurrency] = useState<(typeof CURRENCIES)[number]>('sats')
  const [categoriesInput, setCategoriesInput] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canPublish = title.trim() && description.trim() && rewardAmount.trim() && !publishing

  async function handlePublish() {
    if (!canPublish) return
    setPublishing(true)
    setError(null)
    try {
      await publishJobOffer({
        title,
        description,
        rewardAmount,
        rewardCurrency,
        categories: categoriesInput.split(',').map((c) => c.trim()).filter(Boolean),
      })

      setTitle('')
      setDescription('')
      setRewardAmount('')
      setCategoriesInput('')
      setPublished(true)
      setTimeout(() => setPublished(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish job')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="article-composer">
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Job title"
      />
      <textarea
        className="textarea"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What needs to be done?"
        rows={6}
      />
      <div className="field-row">
        <input
          className="input"
          type="number"
          min="0"
          step="any"
          value={rewardAmount}
          onChange={(e) => setRewardAmount(e.target.value)}
          placeholder="Reward"
        />
        <select
          className="input"
          value={rewardCurrency}
          onChange={(e) => setRewardCurrency(e.target.value as (typeof CURRENCIES)[number])}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <input
        className="input"
        value={categoriesInput}
        onChange={(e) => setCategoriesInput(e.target.value)}
        placeholder="Skill tags, comma separated (e.g. go, relay, nostr)"
      />
      {error && <p className="alert-error">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={handlePublish} disabled={!canPublish}>
          {publishing ? 'Publishing…' : published ? 'Published!' : 'Post job'}
        </button>
      </div>
    </div>
  )
}
