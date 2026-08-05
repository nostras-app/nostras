import { useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { uploadToBlossom } from '../lib/blossom'

export function ArticleComposer() {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [image, setImage] = useState('')
  const [content, setContent] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [published, setPublished] = useState(false)

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
    setPublishing(true)
    try {
      const now = Math.floor(Date.now() / 1000)
      const tags: string[][] = [
        ['d', crypto.randomUUID()],
        ['title', title.trim()],
        ['published_at', String(now)],
      ]
      if (summary.trim()) tags.push(['summary', summary.trim()])
      if (image.trim()) tags.push(['image', image.trim()])

      const event = new NDKEvent(ndk, { kind: 30023, content, tags })
      await event.publish(devPublishRelaySet)

      setTitle('')
      setSummary('')
      setImage('')
      setContent('')
      setPublished(true)
      setTimeout(() => setPublished(false), 3000)
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
    </div>
  )
}
