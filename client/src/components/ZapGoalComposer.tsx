import { useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, publicRelayUrls } from '../lib/ndk'
import { uploadToBlossom } from '../lib/blossom'

// Same explicit-timeout convention as every other publish path in this
// app (Composer.tsx, ArticleComposer.tsx, etc.).
const PUBLISH_TIMEOUT_MS = 8000

// NIP-75 zap goal — a real, previously-nonexistent gap: no way to
// publish a fundraising target that others could zap toward and see
// real progress on. Deliberately minimal for this pass: no closed_at
// (an expiring goal) and no multi-beneficiary "zap" split tag — both
// real NIP-75 features, both separate scope from "a goal exists and can
// be contributed to."
export function ZapGoalComposer() {
  const [description, setDescription] = useState('')
  const [amountSats, setAmountSats] = useState('')
  const [image, setImage] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleImageUpload(file: File | undefined) {
    if (!file) return
    setUploadingImage(true)
    try {
      const blob = await uploadToBlossom(file)
      setImage(blob.url)
    } finally {
      setUploadingImage(false)
    }
  }

  async function handlePublish() {
    const sats = Number(amountSats)
    if (!description.trim() || !Number.isInteger(sats) || sats <= 0 || publishing) return

    setPublishing(true)
    setError(null)
    try {
      const tags: string[][] = [
        ['amount', String(sats * 1000)],
        ...publicRelayUrls.map((url) => ['relays', url]),
      ]
      if (image.trim()) tags.push(['image', image.trim()])

      const event = new NDKEvent(ndk, { kind: 9041, content: description.trim(), tags })
      await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)

      setDescription('')
      setAmountSats('')
      setImage('')
      setPublished(true)
      setTimeout(() => setPublished(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish zap goal')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="article-composer">
      <textarea
        className="textarea"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What are you raising sats for?"
        rows={4}
      />
      <input
        className="input"
        value={amountSats}
        onChange={(e) => setAmountSats(e.target.value)}
        placeholder="Target amount in sats (e.g. 100000)"
        inputMode="numeric"
      />
      <div className="field-row">
        <input
          className="input"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="Image URL (optional)"
        />
        <label className="btn btn-secondary btn-sm article-cover-upload-btn">
          {uploadingImage ? 'Uploading…' : 'Upload'}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={uploadingImage}
            onChange={(e) => handleImageUpload(e.target.files?.[0])}
          />
        </label>
      </div>

      <div className="btn-row">
        {published && <span className="field-hint">Published!</span>}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handlePublish}
          disabled={publishing || !description.trim() || !amountSats.trim()}
        >
          {publishing ? 'Publishing…' : 'Publish zap goal'}
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
