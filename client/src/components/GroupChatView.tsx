import { useMemo, useState } from 'react'
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
import { GroupMemberList, type GroupParticipant } from './GroupMemberList'
import { ArrowLeftIcon, UsersIcon, SettingsIcon, LinkIcon, TrashIcon } from './icons'

function authorLabel(pubkey: string, name: string | null | undefined) {
  return name || `${nip19.npubEncode(pubkey).slice(0, 12)}…`
}

function MessageRow({
  pubkey,
  content,
  createdAt,
  isOwn,
  canDelete,
  deleting,
  onDelete,
}: {
  pubkey: string
  content: string
  createdAt: number
  isOwn: boolean
  canDelete: boolean
  deleting: boolean
  onDelete: () => void
}) {
  const profile = useProfile(pubkey)
  const label = authorLabel(pubkey, profile?.name || profile?.displayName)

  return (
    <div className={`dm-bubble group-message-bubble${isOwn ? ' dm-bubble-own' : ' dm-bubble-peer'}`}>
      {!isOwn && <span className="feed-item-name group-message-author">{label}</span>}
      <p>{content}</p>
      <span className="dm-bubble-time">{formatRelativeTime(createdAt)}</span>
      {canDelete && (
        <button
          type="button"
          className="group-message-delete-btn"
          onClick={onDelete}
          disabled={deleting}
          title="Delete message (admin)"
          aria-label="Delete message"
        >
          <TrashIcon />
        </button>
      )}
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
  const { messages, loading, deleteMessage, deletingMessageId, deleteError } = useGroupChat(group.id)
  const membership = useGroupMembership(group.id)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adminPanelOpen, setAdminPanelOpen] = useState(false)
  const [memberListOpen, setMemberListOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const viewerIsAdmin = !!activeUser && membership.isAdmin(activeUser.pubkey)

  // The group id alone is enough to deep-link back in — see deeplink.ts's
  // own comment on why this doesn't reuse the `?nostr=` naddr/nevent
  // scheme. Preserves the origin as-is rather than hardcoding a host, so
  // this works unchanged across local dev and production.
  function handleCopyLink() {
    const url = new URL(window.location.href)
    url.search = `?group=${encodeURIComponent(group.id)}`
    navigator.clipboard.writeText(url.toString())
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  // v1 has no formal membership concept (open groups — see
  // server/nip29.go), so "members" is everyone actually visible here:
  // every current admin plus every distinct pubkey that's posted a
  // message. Derived from data both hooks already fetched — no new
  // subscription, no kind:39002 involved (nothing in this app ever
  // publishes that).
  const participants = useMemo<GroupParticipant[]>(() => {
    const seen = new Map<string, boolean>()
    for (const admin of membership.admins) seen.set(admin, true)
    for (const msg of messages) if (!seen.has(msg.pubkey)) seen.set(msg.pubkey, false)
    return Array.from(seen.entries()).map(([pubkey, isAdmin]) => ({ pubkey, isAdmin }))
  }, [membership.admins, messages])

  async function handleSend() {
    const trimmed = draft.trim()
    if (!trimmed || sending || membership.isDeleted) return
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
          <div className="profile-stats">
            <button
              type="button"
              className="profile-stat-btn"
              onClick={() => setMemberListOpen(true)}
              disabled={participants.length === 0}
            >
              <strong>{participants.length}</strong> {participants.length === 1 ? 'member' : 'members'}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="dm-back-btn"
          onClick={handleCopyLink}
          title={linkCopied ? 'Link copied' : 'Copy link to this group'}
        >
          <LinkIcon />
        </button>
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
          onDeleteGroup={membership.deleteGroup}
        />
      )}

      {membership.isDeleted && (
        <p className="alert-error group-deleted-banner">
          This group has been deleted — no new messages can be sent.
          Existing messages remain visible below.
        </p>
      )}

      {memberListOpen && (
        <GroupMemberList participants={participants} onClose={() => setMemberListOpen(false)} />
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
            canDelete={viewerIsAdmin}
            deleting={deletingMessageId === msg.id}
            onDelete={() => deleteMessage(msg.id)}
          />
        ))}
      </div>

      <div className="dm-compose">
        <textarea
          className="textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={membership.isDeleted ? 'This group has been deleted' : 'Write a message…'}
          rows={2}
          disabled={membership.isDeleted}
        />
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSend}
            disabled={sending || !draft.trim() || membership.isDeleted}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        {error && <p className="alert-error">{error}</p>}
        {deleteError && <p className="alert-error">{deleteError}</p>}
      </div>
    </div>
  )
}
