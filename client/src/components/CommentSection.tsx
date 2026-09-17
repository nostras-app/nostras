import { useState, type ReactNode } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useComments } from '../hooks/useComments'
import { useExternalIdentities } from '../hooks/useExternalIdentities'
import { publishComment } from '../lib/comments'
import { formatRelativeTime } from '../lib/time'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { externalIdentityProfileUrl } from '../lib/externalIdentities'

function CommentRow({
  comment,
  renderExtra,
}: {
  comment: NDKEvent
  renderExtra?: (comment: NDKEvent) => ReactNode
}) {
  const profile = useProfile(comment.pubkey)
  const label = profile?.name || profile?.displayName || `${comment.author.npub.slice(0, 12)}…`
  // Job Board's real motivation for this (a poster judging an
  // applicant), but harmless and mildly useful on any comment thread —
  // a real, independently-verified signal (NIP-39), not a claim.
  const identities = useExternalIdentities(comment.pubkey)
  const github = identities.find((i) => i.platform === 'github')
  const githubUrl = github ? externalIdentityProfileUrl(github.platform, github.identity) : null
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
      {githubUrl && (
        <a
          className="relay-badge"
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          GitHub: {github?.identity}
        </a>
      )}
      {/* NIP-22 content is plaintext only (no HTML/Markdown/formatting per
          the spec itself) — rendered as-is, no segment parsing needed. */}
      <p className="comment-content">{comment.content}</p>
      {renderExtra?.(comment)}
    </li>
  )
}

// NIP-22 comments on a NIP-23 article — a real, previously-nonexistent
// gap: articles had no discussion mechanism at all (only kind:1 notes
// get NIP-10 replies). Scoped to top-level comments only, matching this
// app's established "one level of depth, not a full nested tree"
// precedent (SingleNoteView's own reply view) — no reply-to-a-comment
// UI here.
export function CommentSection({
  rootEvent,
  title = 'Comments',
  placeholder = 'Add a comment…',
  renderExtra,
}: {
  rootEvent: NDKEvent
  // Job Board reuses this component as-is for "Applications" (title
  // overridden) with an owner-only "Pay this applicant" action injected
  // per comment via renderExtra — avoids a second, duplicate useComments
  // subscription just to render one extra button per row, the same
  // duplicate-subscription bug class this app has hit and fixed before.
  title?: string
  placeholder?: string
  renderExtra?: (comment: NDKEvent) => ReactNode
}) {
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
        {title}{comments.length > 0 ? ` (${comments.length})` : ''}
      </h2>

      {comments.length === 0 && <p className="field-hint">No comments yet.</p>}

      {comments.length > 0 && (
        <ul className="comment-list">
          {comments.map((c) => (
            <CommentRow key={c.id} comment={c} renderExtra={renderExtra} />
          ))}
        </ul>
      )}

      <div className="comment-compose">
        <textarea
          className="textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={placeholder}
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
