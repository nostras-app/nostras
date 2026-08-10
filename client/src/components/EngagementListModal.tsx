import { useProfile } from '../hooks/useProfile'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { XIcon } from './icons'

export type EngagementEntry = { pubkey: string; meta?: string }

function EngagementRow({ pubkey, meta, onNavigate }: { pubkey: string; meta?: string; onNavigate: () => void }) {
  const profile = useProfile(pubkey)
  const label = profile?.name || profile?.displayName || `${pubkey.slice(0, 12)}…`

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
      </button>
      {meta && <span className="relay-badge">{meta}</span>}
    </li>
  )
}

// Generic "who did this" modal — same shell as FollowListModal/
// GroupMemberList (this codebase's established pattern for "avatar +
// name + click to view profile" lists), reused here for likes, reposts,
// and zaps rather than three near-identical components. `entries` isn't
// deduped here — each hook feeding this decides that (useReactionList
// dedupes by person for likes/reposts; useZapList deliberately doesn't,
// since a repeat zap from the same person is a separate real
// contribution worth showing on its own line).
export function EngagementListModal({
  title,
  entries,
  onClose,
}: {
  title: string
  entries: EngagementEntry[]
  onClose: () => void
}) {
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
        {entries.length === 0 ? (
          <p className="field-hint">Nobody yet.</p>
        ) : (
          <ul className="follow-list">
            {entries.map((entry, i) => (
              <EngagementRow
                key={`${entry.pubkey}-${i}`}
                pubkey={entry.pubkey}
                meta={entry.meta}
                onNavigate={() => {
                  onClose()
                  viewProfile(entry.pubkey)
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
