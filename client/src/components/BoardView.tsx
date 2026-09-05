import { useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useActiveUser } from '../hooks/useActiveUser'
import { useCommunityFeed } from '../hooks/useCommunityFeed'
import { publishComment } from '../lib/comments'
import { boardsRelaySet, parseCommunityMeta, publishPostApproval } from '../lib/community'
import { formatRelativeTime } from '../lib/time'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { ArrowLeftIcon, UsersIcon } from './icons'

function PostRow({
  post,
  board,
  pending,
  canApprove,
  onApproved,
}: {
  post: NDKEvent
  board: NDKEvent
  pending: boolean
  canApprove: boolean
  onApproved: () => void
}) {
  const profile = useProfile(post.pubkey)
  const label = profile?.name || profile?.displayName || `${post.author.npub.slice(0, 12)}…`
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState('')

  async function handleApprove() {
    setApproving(true)
    setError('')
    try {
      await publishPostApproval(post, board)
      onApproved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve')
    } finally {
      setApproving(false)
    }
  }

  return (
    <li className={`comment-row${pending ? ' board-post-pending' : ''}`}>
      <button type="button" className="comment-author" onClick={() => viewProfile(post.pubkey)}>
        {isSecureImageUrl(profile?.picture) ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <span className="avatar-fallback">{label.charAt(0)}</span>
        )}
        <span className="feed-item-name">{label}</span>
        {post.created_at && (
          <span className="feed-item-time">{formatRelativeTime(post.created_at)}</span>
        )}
        {pending && <span className="board-post-pending-badge">Pending approval</span>}
      </button>
      <p className="comment-content">{post.content}</p>
      {canApprove && pending && (
        <div className="btn-row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleApprove} disabled={approving}>
            {approving ? 'Approving…' : 'Approve'}
          </button>
        </div>
      )}
      {error && <p className="alert-error">{error}</p>}
    </li>
  )
}

export function BoardView({ board, onBack }: { board: NDKEvent; onBack: () => void }) {
  const meta = parseCommunityMeta(board.tags)
  const activeUser = useActiveUser()
  const { approvedPosts, pendingPosts, isModerator, loading } = useCommunityFeed(board)
  const [content, setContent] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  // Bumped to force a re-fetch feel after a moderator approves a post —
  // the live subscription already picks up the new kind:4550 on its own,
  // this just avoids the approve button appearing to do nothing for the
  // brief window before that event round-trips back.
  const [, forceRefresh] = useState(0)

  const amModerator = !!activeUser && isModerator(activeUser.pubkey)

  async function handlePost() {
    if (!content.trim()) return
    setPosting(true)
    setError('')
    try {
      const post = await publishComment(board, content.trim(), boardsRelaySet)
      setContent('')
      // A moderator posting to their own board shouldn't have to also
      // click Approve on themselves every time — real NIP-72 clients
      // (Amethyst included) auto-approve a moderator's own posts. This
      // is deliberately best-effort and separate from the post itself:
      // the post has already genuinely succeeded above regardless of
      // whether this second publish does; a failure here just leaves it
      // sitting in Pending approval, where the existing manual Approve
      // button still works as a fallback.
      if (amModerator) {
        publishPostApproval(post, board).catch(() => {})
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="communities-view">
      <button type="button" className="dm-back-btn" onClick={onBack} title="Back">
        <ArrowLeftIcon />
      </button>

      <div className="communities-group-card-body">
        {isSecureImageUrl(meta.image) ? (
          <img className="avatar" src={meta.image} alt="" />
        ) : (
          <span className="avatar-fallback">
            <UsersIcon />
          </span>
        )}
        <h2 className="communities-heading">{meta.name}</h2>
        {meta.description && <p className="field-hint">{meta.description}</p>}
      </div>

      <div className="comment-compose">
        <textarea
          className="textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Post to this board…"
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
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>

      {amModerator && pendingPosts.length > 0 && (
        <>
          <h3 className="comment-section-title">Pending approval ({pendingPosts.length})</h3>
          <ul className="comment-list">
            {pendingPosts.map((p) => (
              <PostRow
                key={p.id}
                post={p}
                board={board}
                pending
                canApprove
                onApproved={() => forceRefresh((n) => n + 1)}
              />
            ))}
          </ul>
        </>
      )}

      <h3 className="comment-section-title">
        {approvedPosts.length > 0 ? `Posts (${approvedPosts.length})` : 'Posts'}
      </h3>
      {loading ? (
        <p className="field-hint">Loading posts…</p>
      ) : approvedPosts.length === 0 ? (
        <p className="feed-empty-hint">No approved posts yet.</p>
      ) : (
        <ul className="comment-list">
          {approvedPosts.map((p) => (
            <PostRow key={p.id} post={p} board={board} pending={false} canApprove={false} onApproved={() => {}} />
          ))}
        </ul>
      )}
    </div>
  )
}
