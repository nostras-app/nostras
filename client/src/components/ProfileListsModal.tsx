import { useState } from 'react'
import { useFollowSets, type FollowSet } from '../hooks/useFollowSets'
import { useProfile } from '../hooks/useProfile'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { XIcon } from './icons'

function MemberRow({ pubkey, onNavigate }: { pubkey: string; onNavigate: () => void }) {
  const profile = useProfile(pubkey)
  const label = profile?.name || profile?.displayName || `${pubkey.slice(0, 12)}…`
  return (
    <li className="follow-list-row">
      <button type="button" className="feed-item-avatar-btn" onClick={onNavigate} title={`View ${label}'s profile`}>
        {isSecureImageUrl(profile?.picture) ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <span className="avatar-fallback">{label.charAt(0)}</span>
        )}
      </button>
      <button type="button" className="feed-item-name-btn follow-list-name-btn" onClick={onNavigate}>
        <span className="feed-item-name">{label}</span>
      </button>
    </li>
  )
}

function ListEntry({
  set,
  canCopy,
  onClose,
}: {
  set: FollowSet
  canCopy: boolean
  onClose: () => void
}) {
  const { createSet, busy, loading, error } = useFollowSets()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (await createSet(set.title, set.pubkeys)) setCopied(true)
  }

  return (
    <li className="follow-set-row">
      <button type="button" className="follow-set-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="follow-set-title">{set.title}</span>
        <span className="field-hint">
          {set.pubkeys.length} {set.pubkeys.length === 1 ? 'person' : 'people'}
        </span>
      </button>

      {open && (
        <div className="stack">
          {set.pubkeys.length === 0 ? (
            <p className="field-hint">This list is empty.</p>
          ) : (
            <ul className="follow-list">
              {set.pubkeys.map((pk) => (
                <MemberRow
                  key={pk}
                  pubkey={pk}
                  onNavigate={() => {
                    onClose()
                    viewProfile(pk)
                  }}
                />
              ))}
            </ul>
          )}
          {canCopy && (
            <button
              type="button"
              className="btn btn-secondary btn-sm follow-set-delete"
              onClick={handleCopy}
              disabled={copied || loading || !!busy || set.pubkeys.length === 0}
              title="Creates your own copy — later changes to their list won't sync to yours"
            >
              {copied ? 'Copied — it’s now a tab on your Home feed' : busy === 'new' ? 'Copying…' : 'Copy to my lists'}
            </button>
          )}
          {error && <p className="alert-error">{error}</p>}
        </div>
      )}
    </li>
  )
}

// Another user's NIP-51 follow sets (kind:30000), opened from the "Lists"
// stat on their profile. Read-only; "Copy to my lists" creates a new list
// of your own with the same name and members (a snapshot, not a sync).
export function ProfileListsModal({
  name,
  sets,
  isOwnProfile,
  onClose,
}: {
  name: string
  sets: FollowSet[]
  isOwnProfile: boolean
  onClose: () => void
}) {
  return (
    <>
      <div className="note-menu-backdrop" onClick={onClose} />
      <div className="note-menu-panel follow-list-modal" role="dialog" aria-label={`${name}'s lists`}>
        <div className="follow-list-header">
          <span className="translate-panel-label">{isOwnProfile ? 'Your lists' : `${name}'s lists`}</span>
          <button type="button" className="follow-list-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <ul className="follow-set-list">
          {sets.map((set) => (
            <ListEntry key={set.d} set={set} canCopy={!isOwnProfile} onClose={onClose} />
          ))}
        </ul>
        <p className="field-hint">
          {isOwnProfile
            ? 'Manage your lists in Settings › Lists.'
            : 'Public NIP-51 follow sets. Copying makes your own snapshot; it won’t follow their later changes.'}
        </p>
      </div>
    </>
  )
}
