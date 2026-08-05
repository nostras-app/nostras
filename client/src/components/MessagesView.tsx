import { useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'
import { useActiveUser } from '../hooks/useActiveUser'
import { useProfile } from '../hooks/useProfile'
import { useDirectMessages, type Conversation } from '../hooks/useDirectMessages'
import { sendDirectMessage } from '../lib/dm'
import { formatRelativeTime } from '../lib/time'
import { ArrowLeftIcon, MessageSquareIcon } from './icons'

function peerLabel(peerPubkey: string, name: string | null | undefined) {
  return name || `${nip19.npubEncode(peerPubkey).slice(0, 12)}…`
}

function ConversationList({
  conversations,
  loading,
  onSelect,
}: {
  conversations: Conversation[]
  loading: boolean
  onSelect: (peerPubkey: string) => void
}) {
  if (loading && conversations.length === 0) {
    return (
      <div className="feed-empty">
        <p>Loading conversations…</p>
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
        {profile?.picture ? (
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

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(false)

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
        {profile?.picture ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <span className="avatar-fallback">{label.charAt(0)}</span>
        )}
        <span className="feed-item-name">{label}</span>
      </div>

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
            <span className="dm-bubble-time">{formatRelativeTime(msg.createdAt)}</span>
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

export function MessagesView() {
  const { conversations, loading } = useDirectMessages()
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null)
  const [newPeerInput, setNewPeerInput] = useState('')
  const [newPeerError, setNewPeerError] = useState(false)

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

      <ConversationList conversations={conversations} loading={loading} onSelect={setSelectedPeer} />
    </div>
  )
}
