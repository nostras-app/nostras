import { useState } from 'react'
import { useFollowSets, type FollowSet } from '../hooks/useFollowSets'
import { useProfile } from '../hooks/useProfile'
import { viewProfile } from '../lib/navigation'
import { resolvePubkeyOrNip05 } from '../lib/resolvePubkey'
import { isSecureImageUrl } from '../lib/parseContent'

function MemberRow({
  pubkey,
  disabled,
  onRemove,
}: {
  pubkey: string
  disabled: boolean
  onRemove: () => void
}) {
  const profile = useProfile(pubkey)
  const label = profile?.name || profile?.displayName || `${pubkey.slice(0, 12)}…`
  return (
    <li className="linked-account-row">
      <button type="button" className="feed-item-avatar-btn" onClick={() => viewProfile(pubkey)} title={`View ${label}'s profile`}>
        {isSecureImageUrl(profile?.picture) ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <span className="avatar-fallback">{label.charAt(0)}</span>
        )}
      </button>
      <button type="button" className="feed-item-name-btn follow-list-name-btn" onClick={() => viewProfile(pubkey)}>
        <span className="feed-item-name">{label}</span>
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onRemove} disabled={disabled}>
        Remove
      </button>
    </li>
  )
}

function SetRow({ set }: { set: FollowSet }) {
  const { busy, error, renameSet, deleteSet, toggleMember, addMember } = useFollowSets()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(set.title)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addInput, setAddInput] = useState('')
  const [resolving, setResolving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    setResolving(true)
    const pubkey = await resolvePubkeyOrNip05(addInput)
    setResolving(false)
    if (!pubkey) {
      setAddError('Paste an npub, nprofile, hex pubkey, or a NIP-05 address (name@domain).')
      return
    }
    if (set.pubkeys.includes(pubkey)) {
      setAddError('Already on this list.')
      return
    }
    if (await addMember(set.d, pubkey)) setAddInput('')
  }
  const rowBusy = busy === set.d
  const disabled = !!busy

  return (
    <li className="follow-set-row">
      <div className="follow-set-header">
        <button type="button" className="follow-set-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="follow-set-title">{set.title}</span>
          <span className="field-hint">
            {set.pubkeys.length} {set.pubkeys.length === 1 ? 'person' : 'people'}
            {rowBusy ? ' · saving…' : ''}
          </span>
        </button>
      </div>

      {open && (
        <div className="stack">
          <form
            className="list-picker-new"
            onSubmit={(e) => {
              e.preventDefault()
              renameSet(set.d, title)
            }}
          >
            <input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} disabled={disabled} />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={disabled || !title.trim() || title.trim() === set.title}>
              Rename
            </button>
          </form>

          <form className="list-picker-new" onSubmit={handleAdd}>
            <input
              className="input"
              placeholder="Add someone: npub, nprofile or name@domain"
              value={addInput}
              onChange={(e) => {
                setAddInput(e.target.value)
                setAddError(null)
              }}
              disabled={disabled || resolving}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={disabled || resolving || !addInput.trim()}>
              {resolving ? 'Looking up…' : 'Add'}
            </button>
          </form>
          {addError && <p className="alert-error">{addError}</p>}

          {set.pubkeys.length === 0 ? (
            <p className="field-hint">Nobody on this list yet — add someone above, or tap the star on a profile.</p>
          ) : (
            <ul className="linked-accounts-list">
              {set.pubkeys.map((pk) => (
                <MemberRow key={pk} pubkey={pk} disabled={disabled} onRemove={() => toggleMember(set.d, pk)} />
              ))}
            </ul>
          )}

          {confirmDelete ? (
            <div className="btn-row">
              <span className="field-hint">Delete “{set.title}”? This sends a NIP-09 deletion request.</span>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteSet(set.d)} disabled={disabled}>
                Confirm
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm follow-set-delete" onClick={() => setConfirmDelete(true)} disabled={disabled}>
              Delete list
            </button>
          )}
          {error && <p className="alert-error">{error}</p>}
        </div>
      )}
    </li>
  )
}

// Settings > Lists — manage NIP-51 follow sets (kind:30000). Each list
// also appears as its own tab on the Home feed.
export function FollowSetsSettings() {
  const { sets, loading, busy, error, createSet } = useFollowSets()
  const [newTitle, setNewTitle] = useState('')

  return (
    <div className="stack">
      <p className="field-hint">
        Named lists of people (NIP-51 follow sets, kind:30000), each shown
        as its own feed tab. Separate from who you follow. Lists are
        public and work in other Nostr clients too.
      </p>

      {loading ? (
        <p className="field-hint">Loading…</p>
      ) : sets.length === 0 ? (
        <p className="field-hint">No lists yet.</p>
      ) : (
        <ul className="follow-set-list">
          {sets.map((set) => (
            <SetRow key={set.d} set={set} />
          ))}
        </ul>
      )}

      <form
        className="list-picker-new"
        onSubmit={async (e) => {
          e.preventDefault()
          if (await createSet(newTitle)) setNewTitle('')
        }}
      >
        <input
          className="input"
          placeholder="New list name (e.g. VIP)"
          value={newTitle}
          maxLength={60}
          onChange={(e) => setNewTitle(e.target.value)}
          disabled={loading || !!busy}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={loading || !!busy || !newTitle.trim()}>
          {busy === 'new' ? 'Creating…' : 'Create'}
        </button>
      </form>

      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
