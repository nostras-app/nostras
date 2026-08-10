import { useProfile } from '../hooks/useProfile'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { XIcon } from './icons'

export type GroupParticipant = { pubkey: string; isAdmin: boolean }

function MemberRow({ pubkey, isAdmin, onNavigate }: { pubkey: string; isAdmin: boolean; onNavigate: () => void }) {
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
      {isAdmin && <span className="relay-badge">Admin</span>}
    </li>
  )
}

// v1 has no formal membership concept (open groups — see server/nip29.go),
// so "members" here means everyone actually visible in this group: every
// current admin (from useGroupMembership's 9007/9000/9001-derived state,
// not kind:39002 — nothing in this app ever publishes that) plus every
// distinct pubkey that's posted a chat message. GroupChatView computes
// this list once (from data it already has — messages + admins, no new
// subscription) and passes it down, same hook-once-props-down discipline
// as every other list view in this app.
export function GroupMemberList({
  participants,
  onClose,
}: {
  participants: GroupParticipant[]
  onClose: () => void
}) {
  return (
    <>
      <div className="note-menu-backdrop" onClick={onClose} />
      <div className="note-menu-panel follow-list-modal">
        <div className="follow-list-header">
          <span className="translate-panel-label">Members</span>
          <button type="button" className="follow-list-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        {participants.length === 0 ? (
          <p className="field-hint">Nobody's posted here yet.</p>
        ) : (
          <ul className="follow-list">
            {participants.map((p) => (
              <MemberRow
                key={p.pubkey}
                pubkey={p.pubkey}
                isAdmin={p.isAdmin}
                onNavigate={() => {
                  onClose()
                  viewProfile(p.pubkey)
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
