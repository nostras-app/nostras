import { useEffect, useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useActiveUser } from '../hooks/useActiveUser'
import { useProfile } from '../hooks/useProfile'
import { viewProfile } from '../lib/navigation'
import type { Conversation } from '../hooks/useDirectMessages'
import { sendDirectMessage } from '../lib/dm'
import { formatRelativeTime } from '../lib/time'
import { ArrowLeftIcon, MessageSquareIcon, TrashIcon } from './icons'
import { hideDmMessage, clearDmConversation } from '../lib/dmHidden'
import { publishCurrentPreferences } from '../lib/appData'
import { isSecureImageUrl } from '../lib/parseContent'

function peerLabel(peerPubkey: string, name: string | null | undefined) {
  return name || `${nip19.npubEncode(peerPubkey).slice(0, 12)}…`
}

function ConversationList({
  conversations,
  loading,
  decrypting,
  onSelect,
}: {
  conversations: Conversation[]
  loading: boolean
  decrypting: boolean
  onSelect: (peerPubkey: string) => void
}) {
  if (loading && conversations.length === 0) {
    return (
      <div className="feed-empty">
        <p>Loading conversations…</p>
      </div>
    )
  }

  // Distinct from "loading" — the subscription itself has settled, but a
  // remote (bunker) signer is still working through decrypting a real
  // inbox. Without this, conversations.length === 0 would misleadingly
  // flash "No messages yet" while decryption is still genuinely pending.
  if (decrypting && conversations.length === 0) {
    return (
      <div className="feed-empty">
        <p>Decrypting messages…</p>
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <div className="feed-empty">
        <MessageSquareIcon className="feed-empty-icon" />
        <p>No messages yet.</p>
        <p className="feed-empty-hint">
          Start a new conversation above using someone's npub.
        </p>
      </div>
    )
  }

  return (
    <ul className="dm-conversation-list">
      {conversations.map((c) => (
        <ConversationRow key={c.peerPubkey} conversation={c} onSelect={onSelect} />
      ))}
    </ul>
  )
}

function ConversationRow({
  conversation,
  onSelect,
}: {
  conversation: Conversation
  onSelect: (peerPubkey: string) => void
}) {
  const profile = useProfile(conversation.peerPubkey)
  const label = peerLabel(conversation.peerPubkey, profile?.name || profile?.displayName)

  return (
    <li>
      <button
        type="button"
        className="dm-conversation-item"
        onClick={() => onSelect(conversation.peerPubkey)}
      >
        {isSecureImageUrl(profile?.picture) ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <span className="avatar-fallback">{label.charAt(0)}</span>
        )}
        <div className="dm-conversation-item-body">
          <div className="dm-conversation-item-meta">
            <span className="feed-item-name">{label}</span>
            <span className="feed-item-time">
              {formatRelativeTime(conversation.lastMessage.createdAt)}
            </span>
          </div>
          <p className="dm-conversation-preview">{conversation.lastMessage.content}</p>
        </div>
      </button>
    </li>
  )
}

function Thread({
  peerPubkey,
  conversation,
  onBack,
}: {
  peerPubkey: string
  conversation: Conversation | undefined
  onBack: () => void
}) {
  const activeUser = useActiveUser()
  const profile = useProfile(peerPubkey)
  const label = peerLabel(peerPubkey, profile?.name || profile?.displayName)
  const messages = conversation?.messages ?? []
  const npub = nip19.npubEncode(peerPubkey)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(false)
  const [npubCopied, setNpubCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  // Deletions only affect this user's view (see lib/dmHidden.ts) and sync
  // to their other devices through NIP-78 app data.
  function handleDelete(wrapId: string) {
    hideDmMessage(wrapId)
    publishCurrentPreferences().catch(() => {})
  }

  function handleClearChat() {
    const newest = messages.reduce((max, m) => Math.max(max, m.createdAt), 0)
    clearDmConversation(
      peerPubkey,
      messages.map((m) => m.wrapId),
      Math.max(newest, Math.floor(Date.now() / 1000)),
    )
    setConfirmClear(false)
    publishCurrentPreferences().catch(() => {})
  }

  function handleCopyNpub() {
    navigator.clipboard.writeText(npub)
    setNpubCopied(true)
    setTimeout(() => setNpubCopied(false), 1500)
  }

  async function handleSend() {
    const trimmed = draft.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError(false)
    try {
      const recipient = ndk.getUser({ pubkey: peerPubkey })
      await sendDirectMessage(recipient, trimmed)
      setDraft('')
    } catch {
      setError(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="dm-thread">
      <div className="dm-thread-header">
        <button type="button" className="dm-back-btn" onClick={onBack} title="Back">
          <ArrowLeftIcon />
        </button>
        <button
          type="button"
          className="dm-thread-avatar-btn"
          onClick={() => viewProfile(peerPubkey)}
          title="View profile"
        >
          {isSecureImageUrl(profile?.picture) ? (
            <img className="avatar" src={profile.picture} alt="" />
          ) : (
            <span className="avatar-fallback">{label.charAt(0)}</span>
          )}
        </button>
        <div className="dm-thread-identity">
          <button
            type="button"
            className="dm-thread-name-btn"
            onClick={() => viewProfile(peerPubkey)}
          >
            {label}
          </button>
          <button type="button" className="profile-npub" onClick={handleCopyNpub}>
            {npubCopied ? 'Copied!' : `${npub.slice(0, 16)}…`}
          </button>
        </div>
        {messages.length > 0 && !confirmClear && (
          <button
            type="button"
            className="btn btn-secondary btn-sm dm-clear-btn"
            onClick={() => setConfirmClear(true)}
          >
            Clear chat
          </button>
        )}
      </div>

      {confirmClear && (
        <div className="dm-clear-confirm">
          <p className="field-hint">
            Delete {messages.length === 1 ? 'this message' : `all ${messages.length} messages`} in
            this chat from NOSTRAS on your devices? Nostr
            can't remove them from relays or from the other person's app.
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={handleClearChat}>
              Delete all
            </button>
          </div>
        </div>
      )}

      <div className="dm-thread-messages">
        {messages.length === 0 && (
          <p className="dm-thread-empty-hint">No messages in this conversation yet.</p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.wrapId}
            className={`dm-bubble${
              msg.senderPubkey === activeUser?.pubkey ? ' dm-bubble-own' : ' dm-bubble-peer'
            }`}
          >
            <p>{msg.content}</p>
            <div className="dm-bubble-footer">
              <span className="dm-bubble-time">{formatRelativeTime(msg.createdAt)}</span>
              <button
                type="button"
                className="dm-bubble-delete"
                onClick={() => handleDelete(msg.wrapId)}
                title="Delete for me (it stays on relays and in the other person's app)"
                aria-label="Delete message"
              >
                <TrashIcon />
              </button>
            </div>
          </div>
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
        {error && <p className="alert-error">Couldn't send — check the recipient and try again.</p>}
      </div>
    </div>
  )
}

// conversations/loading/decrypting are lifted to App.tsx (which owns
// useDirectMessages(active) directly) rather than called here, so the
// nav rail's unread badge can read the exact same live conversation
// list without opening a second, duplicate subscription to the same
// filter/decrypt pipeline — this hook's own lazy-decrypt design
// (see useDirectMessages.ts) already depends on there being exactly one
// instance keyed to the real `active` state, not two independent ones
// that could each think they own the "active" catch-up behavior.
export function MessagesView({
  initialPeer,
  conversations,
  loading,
  decrypting,
}: {
  initialPeer?: string | null
  conversations: Conversation[]
  loading: boolean
  decrypting: boolean
}) {
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null)
  const [newPeerInput, setNewPeerInput] = useState('')
  const [newPeerError, setNewPeerError] = useState(false)

  // Driven by lib/navigation.ts's startDmWith() (e.g. AboutModal's "Message
  // the developer" action) — re-runs on every initialPeer change so
  // re-triggering it while already on this view still re-opens the thread.
  useEffect(() => {
    if (initialPeer) setSelectedPeer(initialPeer)
  }, [initialPeer])

  function handleStartConversation() {
    const trimmed = newPeerInput.trim()
    if (!trimmed) return
    try {
      const decoded = nip19.decode(trimmed)
      if (decoded.type !== 'npub') throw new Error('not an npub')
      setSelectedPeer(decoded.data)
      setNewPeerInput('')
      setNewPeerError(false)
    } catch {
      setNewPeerError(true)
    }
  }

  if (selectedPeer) {
    const conversation = conversations.find((c) => c.peerPubkey === selectedPeer)
    return (
      <Thread
        peerPubkey={selectedPeer}
        conversation={conversation}
        onBack={() => setSelectedPeer(null)}
      />
    )
  }

  return (
    <div className="dm-view">
      <div className="field-row">
        <input
          className="input"
          value={newPeerInput}
          onChange={(e) => {
            setNewPeerInput(e.target.value)
            setNewPeerError(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleStartConversation()}
          placeholder="npub1… — start a new conversation"
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleStartConversation}
          disabled={!newPeerInput.trim()}
        >
          Start
        </button>
      </div>
      {newPeerError && <p className="alert-error">That doesn't look like a valid npub.</p>}
      <p className="field-hint">
        NIP-17 direct messages — end-to-end encrypted, and the relay only
        ever sees two random-looking wrapper pubkeys, not who's really
        talking to whom.
      </p>

      <ConversationList
        conversations={conversations}
        loading={loading}
        decrypting={decrypting}
        onSelect={setSelectedPeer}
      />
    </div>
  )
}
