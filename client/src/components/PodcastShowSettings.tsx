import { useEffect, useState } from 'react'
import { useMyShowMeta } from '../hooks/useMyShowMeta'
import { uploadToBlossom } from '../lib/blossom'

// NIP-F4 show metadata (kind:10154) editor — the identity currently
// signed in *is* the show for this pass (see lib/podcast.ts's own
// comment on why). Optional: someone only publishing episodes without
// ever filling this in is still spec-valid, just without a show
// byline shown on their episode cards.
export function PodcastShowSettings() {
  const { meta, loading, saving, error, save } = useMyShowMeta()
  const [title, setTitle] = useState('')
  const [image, setImage] = useState('')
  const [description, setDescription] = useState('')
  const [website, setWebsite] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [saved, setSaved] = useState(false)

  // Only overwrite the form's local draft state once the real fetch
  // resolves — otherwise a still-loading empty draft would flash and
  // then get overwritten by the real values, or worse, an in-progress
  // edit would be clobbered if the fetch happened to resolve late.
  useEffect(() => {
    if (!loading) {
      setTitle(meta.title)
      setImage(meta.image)
      setDescription(meta.description)
      setWebsite(meta.website)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

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

  async function handleSave() {
    const ok = await save({ title: title.trim(), image, description, website })
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  if (loading) return <p className="field-hint">Loading your show info…</p>

  return (
    <div className="stack">
      <p className="field-hint">
        Publishing a podcast episode works with just a title, description, and
        audio — filling this in is optional, but gives every episode a real
        show name and cover art instead of standing alone.
      </p>
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Show title"
      />
      <textarea
        className="textarea"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What's this show about?"
        rows={3}
      />
      <div className="field-row">
        <input
          className="input"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          placeholder="Cover art URL (optional)"
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
      <input
        className="input"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        placeholder="Website (optional)"
      />
      <div className="btn-row">
        {saved && <span className="field-hint">Saved!</span>}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={saving || !title.trim()}
        >
          {saving ? 'Saving…' : 'Save show info'}
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
