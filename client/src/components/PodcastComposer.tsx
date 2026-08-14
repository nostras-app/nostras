import { useState } from 'react'
import { publishEpisode } from '../lib/podcast'
import { uploadToBlossom } from '../lib/blossom'

// NIP-F4 podcast episode (kind:54). Show setup (kind:10154, title/image/
// description/website) lives in Settings > Podcast Show — optional, not
// required before publishing an episode, matching the spec's own
// independence between the two kinds.
export function PodcastComposer() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [audioType, setAudioType] = useState('')
  const [content, setContent] = useState('')
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
    setPublishing(true)
    setError(null)
    try {
      await publishEpisode({
        title: title.trim(),
        image,
        description: description.trim(),
        audioUrl: audioUrl.trim(),
        audioType,
        content: content.trim(),
      })
      setTitle('')
      setDescription('')
      setImage('')
      setAudioUrl('')
      setAudioType('')
      setContent('')
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

      <textarea
        className="textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Full show notes (markdown, optional)"
        rows={6}
      />

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
