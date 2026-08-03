import { useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'

export function Composer() {
  const [content, setContent] = useState('')
  const [publishing, setPublishing] = useState(false)

  async function handlePublish() {
    if (!content.trim()) return
    setPublishing(true)
    try {
      const event = new NDKEvent(ndk, { kind: 1, content })
      await event.publish(devPublishRelaySet)
      setContent('')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="composer">
      <textarea
        className="textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What's happening?"
        rows={3}
      />
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handlePublish}
          disabled={publishing || !content.trim()}
        >
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </div>
  )
}
