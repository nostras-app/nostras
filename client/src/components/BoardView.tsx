import { useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useActiveUser } from '../hooks/useActiveUser'
import { useCommunityFeed } from '../hooks/useCommunityFeed'
import { publishComment } from '../lib/comments'
import {
  boardsRelaySet,
  parseCommunityMeta,
  publishPostApproval,
  updateModerators,
} from '../lib/community'
import { formatRelativeTime } from '../lib/time'
import { resolvePubkeyInput } from '../lib/resolvePubkey'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { ArrowLeftIcon, SettingsIcon, UsersIcon } from './icons'

function ModeratorRow({
  pubkey,
  canRemove,
  busy,
  onRemove,
}: {
  pubkey: string
  canRemove: boolean
  busy: boolean
  onRemove: (pubkey: string) => void
}) {
  const profile = useProfile(pubkey)
  const label = profile?.name || profile?.displayName || `${pubkey.slice(0, 12)}…`

  return (
    <li className="follow-list-row">
      {isSecureImageUrl(profile?.picture) ? (
        <img className="avatar" src={profile.picture} alt="" />
      ) : (
        <span className="avatar-fallback">{label.charAt(0)}</span>
      )}
      <span className="feed-item-name-btn follow-list-name-btn">
        <span className="feed-item-name">{label}</span>
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onRemove(pubkey)}
        disabled={busy || !canRemove}
        title={canRemove ? 'Remove moderator' : "A board needs at least one moderator — can't remove the last one"}
      >
        {busy ? '…' : 'Remove'}
      </button>
    </li>
  )
}

// Shown only when the active user is already a moderator (BoardView's own
// amModerator check gates this, not this component itself). Republishes
// the board's own kind:34550 with an updated moderator list — see
// lib/community.ts's updateModerators for why this preserves every other
// tag rather than replacing the event wholesale.
function ModeratorsPanel({
  moderators,
  onUpdate,
}: {
  moderators: string[]
  onUpdate: (next: string[]) => Promise<void>
}) {
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [busyPubkey, setBusyPubkey] = useState<string | null>(null)
  const [busyAdd, setBusyAdd] = useState(false)

  async function handleAdd() {
    const pubkey = resolvePubkeyInput(addInput)
    if (!pubkey) {
      setAddError('Not a valid npub or pubkey')
      return
    }
    if (moderators.includes(pubkey)) {
      setAddError('Already a moderator')
      return
    }
    setAddError('')
    setBusyAdd(true)
    try {
      await onUpdate([...moderators, pubkey])
      setAddInput('')
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not add moderator')
    } finally {
      setBusyAdd(false)
    }
  }

  async function handleRemove(pubkey: string) {
    setBusyPubkey(pubkey)
    try {
      await onUpdate(moderators.filter((m) => m !== pubkey))
    } catch {
      // Left silently visible on the row itself would need per-row error
      // state; a failed remove just leaves the moderator list unchanged,
      // which the next render already reflects correctly on its own.
    } finally {
      setBusyPubkey(null)
    }
  }

  return (
    <div className="group-admin-panel">
      <p className="field-hint">Board moderators — visible only to moderators.</p>
      <ul className="follow-list">
        {moderators.map((pubkey) => (
          <ModeratorRow
            key={pubkey}
            pubkey={pubkey}
            canRemove={moderators.length > 1}
            busy={busyPubkey === pubkey}
            onRemove={handleRemove}
          />
        ))}
      </ul>
      <div className="btn-row">
        <input
          className="input"
          placeholder="npub to add as moderator"
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleAdd} disabled={busyAdd || !addInput.trim()}>
          {busyAdd ? 'Adding…' : 'Add'}
        </button>
      </div>
      {addError && <p className="alert-error">{addError}</p>}
    </div>
  )
}

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

export function BoardView({ board: initialBoard, onBack }: { board: NDKEvent; onBack: () => void }) {
  // Local, not just the initial prop: adding/removing a moderator
  // republishes the board's own kind:34550 event (same d tag, a new
  // object) — BoardsView's own boardTarget (lib/navigation.ts) is a
  // one-time snapshot from when this view was opened, not a live
  // subscription, so this component has to track the update itself
  // rather than wait for a prop that will never change.
  const [board, setBoard] = useState(initialBoard)
  const meta = parseCommunityMeta(board.tags)
  const activeUser = useActiveUser()
  const { approvedPosts, pendingPosts, isModerator, loading } = useCommunityFeed(board)
  const [content, setContent] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  const [adminPanelOpen, setAdminPanelOpen] = useState(false)
  // Bumped to force a re-fetch feel after a moderator approves a post —
  // the live subscription already picks up the new kind:4550 on its own,
  // this just avoids the approve button appearing to do nothing for the
  // brief window before that event round-trips back.
  const [, forceRefresh] = useState(0)

  const amModerator = !!activeUser && isModerator(activeUser.pubkey)

  async function handleUpdateModerators(next: string[]) {
    const updated = await updateModerators(board, next)
    setBoard(updated)
  }

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
    // Deliberately not .communities-view — that class centers every
    // direct child (align-items: center), right for the discovery list
    // (BoardsView) but wrong here: it was squeezing the header, the
    // compose textarea, and the post list all down to their own
    // content width instead of using the card's full space. Reuses
    // .dm-thread/.dm-thread-header's own left-aligned, full-width
    // layout instead — the exact same pattern GroupChatView already
    // uses for its own single-actions-row header.
    <div className="dm-thread board-view">
      <div className="dm-thread-header">
        <button type="button" className="dm-back-btn" onClick={onBack} title="Back">
          <ArrowLeftIcon />
        </button>
        {isSecureImageUrl(meta.image) ? (
          <img className="avatar" src={meta.image} alt="" />
        ) : (
          <span className="avatar-fallback">
            <UsersIcon />
          </span>
        )}
        <div className="group-chat-header-body">
          <span className="feed-item-name">{meta.name}</span>
          {meta.description && <p className="group-chat-about">{meta.description}</p>}
        </div>
        {amModerator && (
          <button
            type="button"
            className="dm-back-btn"
            onClick={() => setAdminPanelOpen((v) => !v)}
            title="Manage moderators"
          >
            <SettingsIcon />
          </button>
        )}
      </div>

      {amModerator && adminPanelOpen && (
        <ModeratorsPanel moderators={meta.moderators} onUpdate={handleUpdateModerators} />
      )}

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
