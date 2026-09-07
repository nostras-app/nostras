import { useActiveUser } from '../hooks/useActiveUser'
import { useFollowing } from '../hooks/useFollowing'
import { useProfile } from '../hooks/useProfile'
import { useFollowerCount } from '../hooks/useFollowerCount'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { XIcon } from './icons'

function FollowListRow({
  pubkey,
  isFollowing,
  isSelf,
  busy,
  onToggle,
  onNavigate,
}: {
  pubkey: string
  isFollowing: boolean
  isSelf: boolean
  busy: boolean
  onToggle: (pubkey: string) => void
  onNavigate: () => void
}) {
  const profile = useProfile(pubkey)
  const label = profile?.name || profile?.displayName || `${pubkey.slice(0, 12)}…`
  const followerCount = useFollowerCount(pubkey)

  return (
    <li className="follow-list-row">
      <button
        type="button"
        className="feed-item-avatar-btn"
        onClick={onNavigate}
        title={`View ${label}'s profile`}
      >
        {isSecureImageUrl(profile?.picture) ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <span className="avatar-fallback">{label.charAt(0)}</span>
        )}
      </button>
      <button type="button" className="feed-item-name-btn follow-list-name-btn" onClick={onNavigate}>
        <span className="feed-item-name">{label}</span>
        <span
          className="follow-list-follower-count"
          title="Followers visible across connected relays, not the whole network"
        >
          {followerCount === null
            ? '…'
            : `${followerCount.count.toLocaleString()}${followerCount.truncated ? '+' : ''}`}{' '}
          followers
        </span>
      </button>
      {isSelf ? (
        <span className="field-hint">You</span>
      ) : (
        <button
          type="button"
          className={`btn btn-sm ${isFollowing ? 'btn-secondary' : 'btn-primary'}`}
          onClick={() => onToggle(pubkey)}
          disabled={busy}
        >
          {busy ? '…' : isFollowing ? 'Unfollow' : 'Follow'}
        </button>
      )}
    </li>
  )
}

// Real user request (2026-08-08): the Following/Followers counts on a
// profile were plain text, no way to see who's actually on either list
// or to follow someone from it. Reuses useFollowCounts' already-fetched
// pubkey lists (no second query) and the same useFollowing() hook
// ProfileView's own Follow button uses — called once here, not per row,
// matching this project's standing lesson (from the DM conversation-list
// duplicate-subscription bug) about not re-deriving the same hook's state
// once per list item.
export function FollowListModal({
  title,
  pubkeys,
  onClose,
}: {
  title: string
  pubkeys: string[]
  onClose: () => void
}) {
  const activeUser = useActiveUser()
  const { isFollowing, toggle, busy, loading, error } = useFollowing()

  return (
    <>
      <div className="note-menu-backdrop" onClick={onClose} />
      <div className="note-menu-panel follow-list-modal">
        <div className="follow-list-header">
          <span className="translate-panel-label">{title}</span>
          <button type="button" className="follow-list-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        {error && <p className="alert-error">{error}</p>}
        {pubkeys.length === 0 ? (
          <p className="field-hint">Nobody here yet.</p>
        ) : (
          <ul className="follow-list">
            {pubkeys.map((pubkey) => (
              <FollowListRow
                key={pubkey}
                pubkey={pubkey}
                isFollowing={isFollowing(pubkey)}
                isSelf={pubkey === activeUser?.pubkey}
                busy={busy === pubkey || loading}
                onToggle={toggle}
                onNavigate={() => {
                  onClose()
                  viewProfile(pubkey)
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
