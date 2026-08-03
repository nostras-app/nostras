import { useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useActiveUser } from '../hooks/useActiveUser'
import { useProfile } from '../hooks/useProfile'

export function Composer() {
  const [content, setContent] = useState('')
  const [publishing, setPublishing] = useState(false)
  const activeUser = useActiveUser()
  const profile = useProfile(activeUser?.pubkey)

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
      {profile?.picture ? (
        <img className="avatar" src={profile.picture} alt="" />
      ) : (
        <span className="avatar-fallback">
          {(profile?.name || 'N').charAt(0)}
        </span>
      )}
      <div className="composer-body">
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
    </div>
  )
}
