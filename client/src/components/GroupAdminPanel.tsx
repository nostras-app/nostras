import { useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { isSecureImageUrl } from '../lib/parseContent'

function AdminRow({
  pubkey,
  canDemote,
  busy,
  onDemote,
}: {
  pubkey: string
  canDemote: boolean
  busy: boolean
  onDemote: (pubkey: string) => void
}) {
  const profile = useProfile(pubkey)
  const label = profile?.name || profile?.displayName || `${nip19.npubEncode(pubkey).slice(0, 12)}…`

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
        onClick={() => onDemote(pubkey)}
        disabled={busy || !canDemote}
        title={canDemote ? 'Remove admin' : "A group needs at least one admin — can't demote the last one"}
      >
        {busy ? '…' : 'Demote'}
      </button>
    </li>
  )
}

// Rendered only when the active user is a current admin (GroupChatView's
// own isAdmin(activeUser.pubkey) check gates this, not this component
// itself). "Remove member" is deliberately scoped to admin demotion only
// (kind:9001 as the inverse of kind:9000) — v1 has no membership-gated
// posting, so a button implying a real kick/ban would promise a
// capability this version doesn't actually have. Real kick/ban is a
// closed-groups-phase feature.
export function GroupAdminPanel({
  name,
  about,
  picture,
  admins,
  busy,
  error,
  onPromote,
  onDemote,
  onEditMetadata,
}: {
  name: string
  about: string
  picture: string
  admins: string[]
  busy: string | null
  error: string | null
  onPromote: (pubkey: string) => void
  onDemote: (pubkey: string) => void
  onEditMetadata: (name: string, about: string, picture: string) => void
}) {
  const [editName, setEditName] = useState(name)
  const [editAbout, setEditAbout] = useState(about)
  const [editPicture, setEditPicture] = useState(picture)
  const [promoteInput, setPromoteInput] = useState('')
  const [promoteError, setPromoteError] = useState(false)

  function handlePromote() {
    const trimmed = promoteInput.trim()
    if (!trimmed) return
    try {
      const decoded = nip19.decode(trimmed)
      if (decoded.type !== 'npub') throw new Error('not an npub')
      onPromote(decoded.data)
      setPromoteInput('')
      setPromoteError(false)
    } catch {
      setPromoteError(true)
    }
  }

  return (
    <div className="group-admin-panel">
      <p className="field-hint">Group admin tools — visible only to admins.</p>

      <div className="communities-create-form">
        <input
          className="input"
          placeholder="Group name"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
        />
        <textarea
          className="textarea"
          placeholder="About (optional)"
          value={editAbout}
          onChange={(e) => setEditAbout(e.target.value)}
          rows={2}
        />
        <input
          className="input"
          placeholder="Picture URL (optional)"
          value={editPicture}
          onChange={(e) => setEditPicture(e.target.value)}
        />
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onEditMetadata(editName, editAbout, editPicture)}
            disabled={busy === 'metadata' || !editName.trim()}
          >
            {busy === 'metadata' ? 'Saving…' : 'Save metadata'}
          </button>
        </div>
      </div>

      <div className="field-row">
        <input
          className="input"
          value={promoteInput}
          onChange={(e) => {
            setPromoteInput(e.target.value)
            setPromoteError(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && handlePromote()}
          placeholder="npub1… — promote to admin"
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handlePromote}
          disabled={!promoteInput.trim() || !!busy}
        >
          Promote
        </button>
      </div>
      {promoteError && <p className="alert-error">That doesn't look like a valid npub.</p>}

      <ul className="follow-list">
        {admins.map((pubkey) => (
          <AdminRow
            key={pubkey}
            pubkey={pubkey}
            canDemote={admins.length > 1}
            busy={busy === pubkey}
            onDemote={onDemote}
          />
        ))}
      </ul>

      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
