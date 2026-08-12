import { useState } from 'react'
import { useGroupList, type Group } from '../hooks/useGroupList'
import { GroupChatView } from './GroupChatView'
import { publishCreateGroup } from '../lib/groups'
import { viewGroup, setActiveView } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { UsersIcon } from './icons'

function GroupCard({ group, onSelect }: { group: Group; onSelect: () => void }) {
  return (
    <button type="button" className="communities-group-card" onClick={onSelect}>
      {isSecureImageUrl(group.picture) ? (
        <img className="avatar" src={group.picture} alt="" />
      ) : (
        <span className="avatar-fallback">
          <UsersIcon />
        </span>
      )}
      <div className="communities-group-card-body">
        <span className="feed-item-name">{group.name}</span>
        {group.about && <p className="communities-group-card-about">{group.about}</p>}
      </div>
    </button>
  )
}

function CreateGroupForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [picture, setPicture] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!name.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      const id = await publishCreateGroup(name, about, picture)
      setName('')
      setAbout('')
      setPicture('')
      setOpen(false)
      onCreated(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create group')
    } finally {
      setCreating(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Create group
      </button>
    )
  }

  return (
    <div className="communities-create-form">
      <input
        className="input"
        placeholder="Group name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        className="textarea"
        placeholder="What's this group about? (optional)"
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        rows={2}
      />
      <input
        className="input"
        placeholder="Picture URL (optional)"
        value={picture}
        onChange={(e) => setPicture(e.target.value)}
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

// Thin router, same discipline as MessagesView: useGroupList() is called
// exactly once, here, and never inside GroupChatView/GroupCard — avoids
// the duplicate-subscription-per-row bug class this codebase has already
// hit once for DMs. groupTarget (from lib/navigation.ts's viewGroup())
// picks list mode vs. chat mode, same shape as MessagesView's dmTarget.
export function CommunitiesView({ groupTarget }: { groupTarget?: string | null } = {}) {
  const { groups, findGroup, loading } = useGroupList()

  if (groupTarget) {
    // findGroup, not the (deleted-filtered) `groups` list — opening a
    // specific group by id (a "back" navigation into one already open,
    // or a stale deep link) should still resolve a deleted group and
    // show its real "deleted" state, not a misleading "doesn't exist."
    const group = findGroup(groupTarget)
    if (group) {
      return <GroupChatView group={group} onBack={() => setActiveView('communities')} />
    }
    // Metadata for a just-created (or deep-linked) group may not have
    // arrived through the live subscription yet — a brief loading state
    // here avoids flashing the full list+create UI before switching to
    // the chat view a moment later. But `loading` going false means
    // useGroupList's subscription has already reached EOSE (the full
    // current group list has arrived) with no match — a stale or bad
    // group link (a real new failure mode once deep links exist, not
    // hypothetical) would otherwise hang on "Loading group…" forever
    // instead of ever telling the user anything.
    if (loading) {
      return (
        <div className="communities-view">
          <p className="field-hint">Loading group…</p>
        </div>
      )
    }
    return (
      <div className="communities-view">
        <p className="feed-empty-hint">
          This group doesn't exist, or hasn't reached this relay yet.
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => setActiveView('communities')}>
          Back to Communities
        </button>
      </div>
    )
  }

  return (
    <div className="communities-view communities-list-view">
      <span className="communities-icon">
        <UsersIcon />
      </span>
      <h2 className="communities-heading">Communities</h2>
      <p className="communities-lede">
        Real-time group chat hosted on NOSTRAS's own relay (NIP-29) — your
        existing Nostr identity, no separate account.
      </p>

      <CreateGroupForm onCreated={(id) => viewGroup(id)} />

      {/* Real bug found live in production, not caught locally: this used
          to render `groups` progressively as events streamed in,
          independent of `loading`. Group metadata (kind:39000) and
          deletion history (kind:9007/9008) arrive as separate events over
          the same subscription — a genuinely-deleted group's metadata
          can arrive and render before its own deletion event has been
          processed, then disappear once it catches up a moment later.
          Never showed up against this project's own sparse local test
          data (too little concurrent activity for the race to be
          visible), but was real against production's actual group
          count. Waiting for `loading` (EOSE — the subscription has
          finished delivering its current backlog for both event types
          together) before rendering the list at all closes the window;
          post-EOSE live updates for a genuinely new group still stream
          in immediately as before. */}
      {loading ? (
        <p className="field-hint">Loading groups…</p>
      ) : groups.length === 0 ? (
        <p className="feed-empty-hint">No groups yet — create the first one.</p>
      ) : (
        <div className="communities-group-list">
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} onSelect={() => viewGroup(group.id)} />
          ))}
        </div>
      )}
    </div>
  )
}
