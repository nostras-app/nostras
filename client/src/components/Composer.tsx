import { useRef, useState } from 'react'
import { NDKEvent, normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import type { NDKRelay } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useActiveUser } from '../hooks/useActiveUser'
import { useProfile } from '../hooks/useProfile'
import { usePublishTargets } from '../hooks/usePublishTargets'
import { uploadToBlossom } from '../lib/blossom'
import { isSecureImageUrl } from '../lib/parseContent'
import { setActiveView } from '../lib/navigation'
import { ImageIcon, XIcon } from './icons'

type Attachment = {
  id: string
  file: File
  status: 'uploading' | 'done' | 'error'
  url?: string
  error?: string
}

type RelayResult = { status: 'pending' | 'success' | 'failed'; error?: string }

// NDKEvent.publish() defaults to a 2.5s per-relay timeout, tight given
// this relay's demonstrated occasional latency under load (same fix
// already applied to useFollowing.ts/etc for the identical bug class).
const PUBLISH_TIMEOUT_MS = 8000

export function Composer() {
  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  // Real gap found (2026-08-09): NDKRelaySet.publish() only requires ONE
  // relay to succeed by default — a note can silently miss several of the
  // session's toggled publish targets (a relay disconnected, a relay
  // rejecting the kind by its own policy — e.g. purplepag.es genuinely
  // rejects kind:1 with "blocked: kind 1 is not allowed", confirmed via a
  // raw test publish) while `publish()` still resolves with no error at
  // all, since the overall threshold (1) was met. Same event-based
  // per-relay tracking already used by NoteMenu's rebroadcast picker
  // (NDKRelayPublisher emits "relay:published"/"relay:publish:failed" on
  // the event itself as each relay resolves), but also keeps the real
  // error text from the failure event — that's specifically what made the
  // purplepag.es diagnosis possible, so it's surfaced here as a tooltip
  // rather than a generic "failed" the way NoteMenu's simpler version
  // does.
  const [relayResults, setRelayResults] = useState<Record<string, RelayResult>>({})
  const activeUser = useActiveUser()
  const profile = useProfile(activeUser?.pubkey)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Subscribes so the "Publishing to N relays" line below re-renders when
  // the user changes their session's publish targets in Settings — makes
  // the relay mechanic visible right where it matters (before hitting
  // Publish), not just discoverable if someone happens to dig into
  // Settings first. Prompted directly by a real incident: three real
  // outreach replies published successfully by every visible signal and
  // were invisible to their recipients, because the fact that publishing
  // has a *scope* at all wasn't surfaced anywhere near the action itself.
  usePublishTargets()
  const publishTargetCount = devPublishRelaySet.relays.size

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

    const targetUrls = Array.from(devPublishRelaySet.relays).map((r) => normalizeRelayUrl(r.url))
    setRelayResults(Object.fromEntries(targetUrls.map((u) => [u, { status: 'pending' as const }])))

    const event = new NDKEvent(ndk, {
      kind: 1,
      content: [content.trim(), ...attachments.filter((a) => a.status === 'done').map((a) => a.url as string)]
        .filter(Boolean)
        .join('\n\n'),
    })

    const onPublished = (relay: NDKRelay) => {
      setRelayResults((prev) => ({ ...prev, [relay.url]: { status: 'success' } }))
    }
    const onFailed = (relay: NDKRelay, err: unknown) => {
      setRelayResults((prev) => ({
        ...prev,
        [relay.url]: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
      }))
    }
    event.on('relay:published', onPublished)
    event.on('relay:publish:failed', onFailed)

    try {
      await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
      setContent('')
      setAttachments([])
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Failed to publish')
    } finally {
      // A relay that neither published nor explicitly failed (e.g. never
      // connected in time) stays "pending" forever otherwise.
      setRelayResults((prev) => {
        const next = { ...prev }
        for (const u of targetUrls) if (next[u]?.status === 'pending') next[u] = { status: 'failed', error: 'No response in time' }
        return next
      })
      event.off('relay:published', onPublished)
      event.off('relay:publish:failed', onFailed)
      setPublishing(false)
    }
  }

  return (
    <div className="composer">
      {isSecureImageUrl(profile?.picture) ? (
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

        <p className="composer-publish-scope">
          Publishing to {publishTargetCount} relay{publishTargetCount === 1 ? '' : 's'}
          {' — '}
          <button
            type="button"
            className="composer-publish-scope-link"
            onClick={() => setActiveView('settings')}
          >
            change
          </button>
        </p>

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
        {Object.keys(relayResults).length > 0 && (
          <div className="composer-relay-results">
            {Object.entries(relayResults).map(([url, r]) => (
              <span
                key={url}
                className={`relay-result relay-result-${r.status} composer-relay-result-item`}
                title={
                  r.status === 'pending'
                    ? 'Waiting…'
                    : r.status === 'success'
                      ? 'Received it'
                      : (r.error ?? 'Rejected, timed out, or unreachable')
                }
              >
                {r.status === 'pending' ? '…' : r.status === 'success' ? '✓' : '✕'}{' '}
                {url.replace('wss://', '').replace(/\/$/, '')}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
