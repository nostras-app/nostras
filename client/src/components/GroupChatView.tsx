import { useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import type { Group } from '../hooks/useGroupList'
import { useGroupChat } from '../hooks/useGroupChat'
import { useGroupMembership } from '../hooks/useGroupMembership'
import { useProfile } from '../hooks/useProfile'
import { useActiveUser } from '../hooks/useActiveUser'
import { sendGroupMessage } from '../lib/groups'
import { formatRelativeTime } from '../lib/time'
import { isSecureImageUrl } from '../lib/parseContent'
import { GroupAdminPanel } from './GroupAdminPanel'
import { ArrowLeftIcon, UsersIcon, SettingsIcon } from './icons'

function authorLabel(pubkey: string, name: string | null | undefined) {
  return name || `${nip19.npubEncode(pubkey).slice(0, 12)}…`
}

function MessageRow({
  pubkey,
  content,
  createdAt,
  isOwn,
}: {
  pubkey: string
  content: string
  createdAt: number
  isOwn: boolean
}) {
  const profile = useProfile(pubkey)
  const label = authorLabel(pubkey, profile?.name || profile?.displayName)

  return (
    <div className={`dm-bubble${isOwn ? ' dm-bubble-own' : ' dm-bubble-peer'}`}>
      {!isOwn && <span className="feed-item-name group-message-author">{label}</span>}
      <p>{content}</p>
      <span className="dm-bubble-time">{formatRelativeTime(createdAt)}</span>
    </div>
  )
}

// Reuses the .dm-thread/.dm-bubble/.dm-compose layout MessagesView's
// Thread already established — group chat is structurally the same shape
// (header + scrollable message list + inline composer), just with a
// group instead of a DM peer and a visible author label per message
// (unlike a 1:1 thread, a group has more than one other participant).
export function GroupChatView({ group, onBack }: { group: Group; onBack: () => void }) {
  const activeUser = useActiveUser()
  const { messages, loading } = useGroupChat(group.id)
  const membership = useGroupMembership(group.id)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adminPanelOpen, setAdminPanelOpen] = useState(false)

  const viewerIsAdmin = !!activeUser && membership.isAdmin(activeUser.pubkey)

  async function handleSend() {
    const trimmed = draft.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError(null)
    try {
      await sendGroupMessage(group.id, trimmed)
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="dm-thread group-chat-view">
      <div className="dm-thread-header">
        <button type="button" className="dm-back-btn" onClick={onBack} title="Back">
          <ArrowLeftIcon />
        </button>
        {isSecureImageUrl(group.picture) ? (
          <img className="avatar" src={group.picture} alt="" />
        ) : (
          <span className="avatar-fallback">
            <UsersIcon />
          </span>
        )}
        <div className="group-chat-header-body">
          <span className="feed-item-name">{group.name}</span>
          {group.about && <p className="group-chat-about">{group.about}</p>}
        </div>
        {viewerIsAdmin && (
          <button
            type="button"
            className="dm-back-btn"
            onClick={() => setAdminPanelOpen((v) => !v)}
            title="Admin tools"
          >
            <SettingsIcon />
          </button>
        )}
      </div>

      {viewerIsAdmin && adminPanelOpen && (
        <GroupAdminPanel
          name={group.name}
          about={group.about}
          picture={group.picture}
          admins={membership.admins}
          busy={membership.busy}
          error={membership.error}
          onPromote={membership.promote}
          onDemote={membership.demote}
          onEditMetadata={membership.editMetadata}
        />
      )}

      <div className="dm-thread-messages">
        {loading && messages.length === 0 && (
          <p className="dm-thread-empty-hint">Loading messages…</p>
        )}
        {!loading && messages.length === 0 && (
          <p className="dm-thread-empty-hint">No messages yet — be the first to say something.</p>
        )}
        {messages.map((msg) => (
          <MessageRow
            key={msg.id}
            pubkey={msg.pubkey}
            content={msg.content}
            createdAt={msg.createdAt}
            isOwn={msg.pubkey === activeUser?.pubkey}
          />
        ))}
      </div>

      <div className="dm-compose">
        <textarea
          className="textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message…"
          rows={2}
        />
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSend}
            disabled={sending || !draft.trim()}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        {error && <p className="alert-error">{error}</p>}
      </div>
    </div>
  )
}
