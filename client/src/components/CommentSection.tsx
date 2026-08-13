import { useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useComments } from '../hooks/useComments'
import { publishComment } from '../lib/comments'
import { formatRelativeTime } from '../lib/time'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'

function CommentRow({ comment }: { comment: NDKEvent }) {
  const profile = useProfile(comment.pubkey)
  const label = profile?.name || profile?.displayName || `${comment.author.npub.slice(0, 12)}…`
  return (
    <li className="comment-row">
      <button type="button" className="comment-author" onClick={() => viewProfile(comment.pubkey)}>
        {isSecureImageUrl(profile?.picture) ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <span className="avatar-fallback">{label.charAt(0)}</span>
        )}
        <span className="feed-item-name">{label}</span>
        {comment.created_at && (
          <span className="feed-item-time">{formatRelativeTime(comment.created_at)}</span>
        )}
      </button>
      {/* NIP-22 content is plaintext only (no HTML/Markdown/formatting per
          the spec itself) — rendered as-is, no segment parsing needed. */}
      <p className="comment-content">{comment.content}</p>
    </li>
  )
}

// NIP-22 comments on a NIP-23 article — a real, previously-nonexistent
// gap: articles had no discussion mechanism at all (only kind:1 notes
// get NIP-10 replies). Scoped to top-level comments only, matching this
// app's established "one level of depth, not a full nested tree"
// precedent (SingleNoteView's own reply view) — no reply-to-a-comment
// UI here.
export function CommentSection({ rootEvent }: { rootEvent: NDKEvent }) {
  const comments = useComments(rootEvent)
  const [content, setContent] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')

  async function handlePost() {
    if (!content.trim()) return
    setPosting(true)
    setError('')
    try {
      await publishComment(rootEvent, content.trim())
      setContent('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post comment')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="comment-section">
      <h2 className="comment-section-title">
        Comments{comments.length > 0 ? ` (${comments.length})` : ''}
      </h2>

      {comments.length === 0 && <p className="field-hint">No comments yet.</p>}

      {comments.length > 0 && (
        <ul className="comment-list">
          {comments.map((c) => (
            <CommentRow key={c.id} comment={c} />
          ))}
        </ul>
      )}

      <div className="comment-compose">
        <textarea
          className="textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
        />
        {error && <p className="alert-error">{error}</p>}
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handlePost}
            disabled={posting || !content.trim()}
          >
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      </div>
    </div>
  )
}
