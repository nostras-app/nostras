import { useRef, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useActiveUser } from '../hooks/useActiveUser'
import { useProfile } from '../hooks/useProfile'
import { uploadToBlossom } from '../lib/blossom'
import { ImageIcon, XIcon } from './icons'

type Attachment = {
  id: string
  file: File
  status: 'uploading' | 'done' | 'error'
  url?: string
  error?: string
}

// NDKEvent.publish() defaults to a 2.5s per-relay timeout, tight given
// this relay's demonstrated occasional latency under load (same fix
// already applied to useFollowing.ts/etc for the identical bug class).
const PUBLISH_TIMEOUT_MS = 8000

export function Composer() {
  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const activeUser = useActiveUser()
  const profile = useProfile(activeUser?.pubkey)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFilesSelected(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`
      setAttachments((prev) => [...prev, { id, file, status: 'uploading' }])
      uploadToBlossom(file)
        .then((blob) => {
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: 'done', url: blob.url } : a)),
          )
        })
        .catch((e) => {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === id
                ? { ...a, status: 'error', error: e instanceof Error ? e.message : 'Upload failed' }
                : a,
            ),
          )
        })
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const uploading = attachments.some((a) => a.status === 'uploading')
  const hasContent = content.trim().length > 0 || attachments.some((a) => a.status === 'done')

  async function handlePublish() {
    if (!hasContent || uploading) return
    setPublishing(true)
    setPublishError(null)
    try {
      const mediaUrls = attachments.filter((a) => a.status === 'done').map((a) => a.url as string)
      const fullContent = [content.trim(), ...mediaUrls].filter(Boolean).join('\n\n')
      const event = new NDKEvent(ndk, { kind: 1, content: fullContent })
      await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
      setContent('')
      setAttachments([])
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Failed to publish')
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

        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((a) => (
              <div key={a.id} className="composer-attachment-chip">
                {a.status === 'uploading' && <span>Uploading {a.file.name}…</span>}
                {a.status === 'done' && <span>✓ {a.file.name}</span>}
                {a.status === 'error' && <span className="alert-error">{a.error}</span>}
                <button
                  type="button"
                  className="composer-attachment-remove"
                  onClick={() => removeAttachment(a.id)}
                  title="Remove"
                >
                  <XIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="btn-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            hidden
            onChange={(e) => {
              handleFilesSelected(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm composer-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image, GIF, video, or audio"
          >
            <ImageIcon />
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handlePublish}
            disabled={publishing || uploading || !hasContent}
          >
            {publishing ? 'Publishing…' : uploading ? 'Uploading…' : 'Publish'}
          </button>
        </div>
        {publishError && <p className="alert-error composer-publish-error">{publishError}</p>}
      </div>
    </div>
  )
}
