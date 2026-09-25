import { useState } from 'react'
import { useFollowSets } from '../hooks/useFollowSets'
import { XIcon } from './icons'

// "Add to lists…" picker opened from the star on someone's profile. One
// checkbox per NIP-51 follow set (kind:30000); checking/unchecking
// republishes just that list. A new list can be created inline, already
// containing this person.
export function ListPickerModal({
  pubkey,
  name,
  onClose,
}: {
  pubkey: string
  name: string
  onClose: () => void
}) {
  const { sets, loading, busy, error, createSet, toggleMember } = useFollowSets()
  const [newTitle, setNewTitle] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (await createSet(newTitle, [pubkey])) setNewTitle('')
  }

  return (
    <>
      <div className="note-menu-backdrop" onClick={onClose} />
      <div className="note-menu-panel follow-list-modal" role="dialog" aria-label={`Add ${name} to lists`}>
        <div className="follow-list-header">
          <span className="translate-panel-label">Add {name} to lists</span>
          <button type="button" className="follow-list-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        {loading ? (
          <p className="field-hint">Loading your lists…</p>
        ) : sets.length === 0 ? (
          <p className="field-hint">You don't have any lists yet. Create one below.</p>
        ) : (
          <ul className="list-picker">
            {sets.map((set) => {
              const checked = set.pubkeys.includes(pubkey)
              return (
                <li key={set.d}>
                  <label className="list-picker-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!!busy}
                      onChange={() => toggleMember(set.d, pubkey)}
                    />
                    <span className="list-picker-title">{set.title}</span>
                    <span className="field-hint">
                      {busy === set.d ? 'Saving…' : `${set.pubkeys.length}`}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        <form className="list-picker-new" onSubmit={handleCreate}>
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
        <p className="field-hint">
          Lists are public NIP-51 follow sets — anyone can see who's on them,
          and other Nostr clients can use them too.
        </p>
      </div>
    </>
  )
}
