import { useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useCommunityList } from '../hooks/useCommunityList'
import { publishCommunityDefinition, type CommunityMeta } from '../lib/community'
import { BoardView } from './BoardView'
import { viewBoard, setActiveView } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { UsersIcon } from './icons'

function BoardCard({ meta, onSelect }: { meta: CommunityMeta; onSelect: () => void }) {
  return (
    <button type="button" className="communities-group-card" onClick={onSelect}>
      {isSecureImageUrl(meta.image) ? (
        <img className="avatar" src={meta.image} alt="" />
      ) : (
        <span className="avatar-fallback">
          <UsersIcon />
        </span>
      )}
      <div className="communities-group-card-body">
        <span className="feed-item-name">{meta.name}</span>
        {meta.description && <p className="communities-group-card-about">{meta.description}</p>}
      </div>
    </button>
  )
}

function CreateBoardForm({ onCreated }: { onCreated: (board: NDKEvent) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!name.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      const board = await publishCommunityDefinition({ name, description, image })
      setName('')
      setDescription('')
      setImage('')
      setOpen(false)
      onCreated(board)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create board')
    } finally {
      setCreating(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Create board
      </button>
    )
  }

  return (
    <div className="communities-create-form">
      <input
        className="input"
        placeholder="Board name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        className="textarea"
        placeholder="What's this board about? (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
      />
      <input
        className="input"
        placeholder="Image URL (optional)"
        value={image}
        onChange={(e) => setImage(e.target.value)}
      />
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setOpen(false)}
          disabled={creating}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleCreate}
          disabled={creating || !name.trim()}
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}

// NIP-72 moderated communities — deliberately named "Boards" in this
// app's UI, not "Communities", to avoid colliding with the existing,
// structurally unrelated NIP-29 feature under that name (real-time
// relay-enforced group chat vs. a moderated post feed — see
// lib/community.ts's own comment for the full distinction). Same thin-
// router shape as CommunitiesView/MessagesView: useCommunityList() is
// called exactly once, here, never inside BoardView/BoardCard.
export function BoardsView({ boardTarget }: { boardTarget?: NDKEvent | null } = {}) {
  const { boards, loading } = useCommunityList()

  if (boardTarget) {
    return <BoardView board={boardTarget} onBack={() => setActiveView('boards')} />
  }

  return (
    <div className="communities-view communities-list-view">
      <span className="communities-icon">
        <UsersIcon />
      </span>
      <h2 className="communities-heading">Boards</h2>
      <p className="communities-lede">
        Moderated post communities (NIP-72) — the same real protocol Amethyst's
        own "Communities" feature uses. Anyone can post; a board's
        moderators decide what's approved into visibility.
      </p>
      <p className="communities-lede communities-cross-link">
        Looking for real-time group chat instead? That's{' '}
        <button type="button" className="link-btn" onClick={() => setActiveView('communities')}>
          Communities
        </button>
        , NOSTRAS's own relay-hosted NIP-29 feature.
      </p>

      <CreateBoardForm onCreated={(board) => viewBoard(board)} />

      {loading ? (
        <p className="field-hint">Loading boards…</p>
      ) : boards.length === 0 ? (
        <p className="feed-empty-hint">No boards yet — create the first one.</p>
      ) : (
        <div className="communities-group-list">
          {boards.map(({ event, meta }) => (
            <BoardCard key={event.id} meta={meta} onSelect={() => viewBoard(event)} />
          ))}
        </div>
      )}
    </div>
  )
}
