import { useState } from 'react'
import { publishEpisode } from '../lib/podcast'
import { uploadToBlossom } from '../lib/blossom'
import { fetchDvmArticleEncryptionPubkey } from '../lib/paidArticles'
import { useActiveUser } from '../hooks/useActiveUser'
import { useProfile } from '../hooks/useProfile'

// NIP-F4 podcast episode (kind:54). Show setup (kind:10154, title/image/
// description/website) lives in Settings > Podcast Show — optional, not
// required before publishing an episode, matching the spec's own
// independence between the two kinds.
export function PodcastComposer() {
  const activeUser = useActiveUser()
  const ownProfile = useProfile(activeUser?.pubkey)
  // Same reasoning as ArticleComposer: the episode's price is paid
  // directly to the host's own Lightning address, so a paid episode with
  // no lud16 set would have nowhere for the payment to go.
  const hasLud16 = Boolean(ownProfile?.lud16)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [audioType, setAudioType] = useState('')
  const [content, setContent] = useState('')
  const [requirePayment, setRequirePayment] = useState(false)
  const [priceSats, setPriceSats] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingAudio, setUploadingAudio] = useState(false)
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

  async function handleAudioUpload(file: File | undefined) {
    if (!file) return
    setUploadingAudio(true)
    try {
      const blob = await uploadToBlossom(file)
      setAudioUrl(blob.url)
      setAudioType(blob.type)
    } finally {
      setUploadingAudio(false)
    }
  }

  async function handlePublish() {
    if (!title.trim() || !audioUrl.trim() || publishing) return

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
      let paid: { priceSats: number; dvmPubkey: string } | undefined
      if (requirePayment) {
        const dvmPubkey = await fetchDvmArticleEncryptionPubkey()
        if (!dvmPubkey) {
          setError('Paid episodes are not available right now — the DVM has not advertised an encryption key. Try again later.')
          setPublishing(false)
          return
        }
        paid = { priceSats: price, dvmPubkey }
      }

      await publishEpisode({
        title: title.trim(),
        image,
        description: description.trim(),
        audioUrl: audioUrl.trim(),
        audioType,
        content: paid ? '' : content.trim(),
        paid,
      })
      setTitle('')
      setDescription('')
      setImage('')
      setAudioUrl('')
      setAudioType('')
      setContent('')
      setRequirePayment(false)
      setPriceSats('')
      setPublished(true)
      setTimeout(() => setPublished(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish episode')
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
        placeholder="Episode title"
      />
      <textarea
        className="textarea"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Brief description (shown in the feed)"
        rows={2}
      />

      <div className="field-row">
        <input
          className="input"
          value={audioUrl}
          onChange={(e) => {
            setAudioUrl(e.target.value)
            setAudioType('')
          }}
          placeholder="Audio URL"
        />
        <label className="btn btn-secondary btn-sm article-cover-upload-btn">
          {uploadingAudio ? 'Uploading…' : 'Upload audio'}
          <input
            type="file"
            accept="audio/*"
            hidden
            disabled={uploadingAudio}
            onChange={(e) => handleAudioUpload(e.target.files?.[0])}
          />
        </label>
      </div>

      <div className="field-row">
        <input
          className="input"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="Episode art (optional — falls back to the show's cover)"
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

      {!requirePayment && (
        <textarea
          className="textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Full show notes (markdown, optional)"
          rows={6}
        />
      )}

      <label className="article-paywall-toggle">
        <input
          type="checkbox"
          checked={requirePayment}
          disabled={!hasLud16}
          onChange={(e) => setRequirePayment(e.target.checked)}
        />
        Require payment to unlock
      </label>
      {!hasLud16 && (
        <p className="field-hint">
          Set a Lightning address in your profile first (Settings &gt; Profile) — that's where a
          listener's payment for this episode goes.
        </p>
      )}

      {requirePayment && hasLud16 && (
        <div className="stack">
          <input
            className="input"
            value={priceSats}
            onChange={(e) => setPriceSats(e.target.value)}
            placeholder="Price in sats (e.g. 500)"
            inputMode="numeric"
          />
          <p className="field-hint">
            Title, description, and episode art stay public — only the audio itself is
            encrypted (full show notes aren't published for a paid episode — there's only one
            "real content" slot per event, and for a paid episode that's the audio). Listeners
            pay this price directly to <strong>your</strong> Lightning address to unlock it, plus
            a small flat fee to NOSTRAS for running the unlock service — that fee is not an
            end-to-end system, our DVM holds the decryption key and reads the plaintext to serve
            it to whoever pays, but your own share never passes through our wallet at all.
          </p>
        </div>
      )}

      <div className="btn-row">
        {published && <span className="field-hint">Published!</span>}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handlePublish}
          disabled={publishing || uploadingAudio || !title.trim() || !audioUrl.trim()}
        >
          {publishing ? 'Publishing…' : 'Publish episode'}
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
