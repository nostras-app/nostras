import { useState } from 'react'
import { publishForumThread } from '../lib/forum'

// NIP-7D forum thread — a real, previously-nonexistent gap: no way to
// start a titled, threaded discussion (as opposed to a plain kind:1
// note, which has no title and gets NIP-10 replies rather than NIP-22
// comments). Deliberately minimal, matching what the spec itself
// actually requires: a title and a body, nothing else.
export function ThreadComposer() {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePublish() {
    if (!title.trim() || !content.trim() || publishing) return
    setPublishing(true)
    setError(null)
    try {
      await publishForumThread(title.trim(), content.trim())
      setTitle('')
      setContent('')
      setPublished(true)
      setTimeout(() => setPublished(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish thread')
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
        placeholder="Thread title"
      />
      <textarea
        className="textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Start the discussion…"
        rows={6}
      />

      <div className="btn-row">
        {published && <span className="field-hint">Published!</span>}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handlePublish}
          disabled={publishing || !title.trim() || !content.trim()}
        >
          {publishing ? 'Publishing…' : 'Publish thread'}
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
