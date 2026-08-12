import { useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { uploadToBlossom } from '../lib/blossom'
import { encryptArticleBody, fetchDvmArticleEncryptionPubkey } from '../lib/paidArticles'

// Matches the 8s convention used everywhere else in this codebase
// (Composer.tsx, useFollowing.ts, the group hooks, etc.) — a real,
// separate gap this file had before: no explicit timeout at all (NDK's
// own tight 2.5s default applied), and no error handling whatsoever —
// a rejected publish() would have been an unhandled promise rejection,
// not caught anywhere, since the old code only had try/finally, never
// try/catch.
const PUBLISH_TIMEOUT_MS = 8000

export function ArticleComposer() {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [image, setImage] = useState('')
  const [content, setContent] = useState('')
  const [requirePayment, setRequirePayment] = useState(false)
  const [priceSats, setPriceSats] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [published, setPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCoverUpload(file: File | undefined) {
    if (!file) return
    setUploadingCover(true)
    try {
      const blob = await uploadToBlossom(file)
      setImage(blob.url)
    } finally {
      setUploadingCover(false)
    }
  }

  async function handlePublish() {
    if (!title.trim() || !content.trim() || publishing) return

    let price = 0
    if (requirePayment) {
      price = Number(priceSats)
      if (!Number.isInteger(price) || price <= 0) {
        setError('Enter a whole number of sats to charge.')
        return
      }
    }

    setPublishing(true)
    setError(null)
    try {
      const now = Math.floor(Date.now() / 1000)
      const tags: string[][] = [
        ['d', crypto.randomUUID()],
        ['title', title.trim()],
        ['published_at', String(now)],
      ]
      if (summary.trim()) tags.push(['summary', summary.trim()])
      if (image.trim()) tags.push(['image', image.trim()])

      let body = content
      if (requirePayment) {
        const dvmPubkey = await fetchDvmArticleEncryptionPubkey()
        if (!dvmPubkey) {
          setError('Paid articles are not available right now — the DVM has not advertised an encryption key. Try again later.')
          setPublishing(false)
          return
        }
        body = await encryptArticleBody(content, dvmPubkey)
        tags.push(['encrypted'])
        tags.push(['price', String(price)])
      }

      const event = new NDKEvent(ndk, { kind: 30023, content: body, tags })
      await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)

      setTitle('')
      setSummary('')
      setImage('')
      setContent('')
      setRequirePayment(false)
      setPriceSats('')
      setPublished(true)
      setTimeout(() => setPublished(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish article')
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
        placeholder="Article title"
      />
      <textarea
        className="textarea"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="Summary (optional)"
        rows={2}
      />
      <div className="field-row">
        <input
          className="input"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="Cover image URL (optional)"
        />
        <label className="btn btn-secondary btn-sm article-cover-upload-btn">
          {uploadingCover ? 'Uploading…' : 'Upload'}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={uploadingCover}
            onChange={(e) => handleCoverUpload(e.target.files?.[0])}
          />
        </label>
      </div>
      <textarea
        className="textarea article-composer-body"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write your article in Markdown…"
        rows={14}
      />

      <label className="article-paywall-toggle">
        <input
          type="checkbox"
          checked={requirePayment}
          onChange={(e) => setRequirePayment(e.target.checked)}
        />
        Require payment to unlock
      </label>

      {requirePayment && (
        <div className="stack">
          <input
            className="input"
            value={priceSats}
            onChange={(e) => setPriceSats(e.target.value)}
            placeholder="Price in sats (e.g. 500)"
            inputMode="numeric"
          />
          <p className="field-hint">
            Title, summary, and cover image stay public — only the body
            is encrypted. Readers pay this price via Lightning through
            NOSTRAS's own DVM to unlock it. That's a real service we
            provide, not an end-to-end system: our DVM holds the
            decryption key and reads the plaintext to serve it to
            whoever pays, the same way any of NOSTRAS's other paid DVM
            jobs work. And like any paywall — once a reader has
            unlocked it, nothing technical stops them from sharing what
            they read further. That's the nature of paying for
            content, not a flaw specific to this.
          </p>
        </div>
      )}

      <div className="btn-row">
        {published && <span className="field-hint">Published!</span>}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handlePublish}
          disabled={publishing || !title.trim() || !content.trim()}
        >
          {publishing ? 'Publishing…' : 'Publish article'}
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
