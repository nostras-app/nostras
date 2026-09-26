import { useEffect, useMemo, useRef, useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import type { Group } from '../hooks/useGroupList'
import { useGroupChat } from '../hooks/useGroupChat'
import { useGroupMembership } from '../hooks/useGroupMembership'
import { useProfile } from '../hooks/useProfile'
import { useActiveUser } from '../hooks/useActiveUser'
import { sendGroupMessage } from '../lib/groups'
import { requestGroupJoin, fetchDvmCommunityAdminPubkey } from '../lib/communities'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { formatRelativeTime } from '../lib/time'
import { isSecureImageUrl } from '../lib/parseContent'
import { GroupAdminPanel } from './GroupAdminPanel'
import { GroupMemberList, type GroupParticipant } from './GroupMemberList'
import { DaoProposalsView } from './DaoProposals'
import { ArrowLeftIcon, UsersIcon, SettingsIcon, LinkIcon, TrashIcon } from './icons'

type JoinState = 'locked' | 'requesting' | 'payment-required' | 'joined' | 'error'

// Reuses the exact processing/payment-required/done/error shape already
// proven in ArticleView.tsx's ArticleUnlockPanel, adapted for a two-step
// payment (the group's own price, tagged "group", then NOSTRAS's flat
// fee — see lib/dvm.ts's DvmJobUpdate comment). No content to unlock
// here — on success the composer takes over naturally once
// useGroupMembership's own live subscription picks up the real kind:9000
// the DVM published; this just shows a brief transient confirmation to
// bridge the gap between the kind:6906 result landing and that
// subscription state updating.
function JoinAndPayPanel({ groupId, priceSats }: { groupId: string; priceSats: number }) {
  const [state, setState] = useState<JoinState>('locked')
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState('')
  const [amountSats, setAmountSats] = useState(priceSats)
  const [payee, setPayee] = useState<'group' | 'nostras'>('group')
  const [paying, setPaying] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cancelRef.current?.(), [])

  function handleJoin() {
    setState('requesting')
    setError('')
    cancelRef.current = requestGroupJoin(groupId, (update) => {
      if (update.status === 'processing') {
        setState('requesting')
      } else if (update.status === 'payment-required') {
        setInvoice(update.invoice)
        setAmountSats(Math.round(update.amountMsat / 1000))
        setPayee(update.payee === 'group' ? 'group' : 'nostras')
        setState('payment-required')
      } else if (update.status === 'done') {
        setState('joined')
      } else if (update.status === 'error') {
        setError(update.message)
        setState('error')
      }
    })
  }

  async function handlePayWithWallet() {
    const nwcUri = getSavedNwcUri()
    if (!nwcUri) return
    setPaying(true)
    try {
      await payInvoiceWithNwc(nwcUri, invoice)
      // Same as ArticleUnlockPanel: the DVM publishes "processing" once
      // it observes settlement, then either the next payment-required
      // (NOSTRAS's own fee) or the final result — onUpdate above carries
      // us the rest of the way.
      setState('requesting')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
      setState('error')
    } finally {
      setPaying(false)
    }
  }

  function handleReset() {
    cancelRef.current?.()
    cancelRef.current = null
    setState('locked')
    setError('')
    setInvoice('')
  }

  if (state === 'joined') {
    return <p className="field-hint">Paid and joined — you can post now.</p>
  }

  return (
    <div className="article-unlock-panel group-join-panel">
      <p className="field-hint">
        This group requires payment to post — anyone can still read the chat.
        {priceSats > 0 && (
          <>
            {' '}
            Joining costs <strong>{priceSats.toLocaleString()} sats</strong>, paid directly to the
            group, plus a small flat fee to NOSTRAS for running the join service.
          </>
        )}
      </p>

      {state === 'locked' && (
        <button type="button" className="btn btn-primary btn-sm" onClick={handleJoin}>
          Join{priceSats > 0 ? ` for ${priceSats.toLocaleString()} sats` : ''}
        </button>
      )}

      {state === 'requesting' && <p className="field-hint">Joining…</p>}

      {state === 'payment-required' && (
        <div className="stack">
          <p className="field-hint">
            {payee === 'group' ? 'Step 1 of 2 — pay the group' : "Step 2 of 2 — pay NOSTRAS's fee"}
            {' — you are paying '}
            <strong>{amountSats} sats</strong>.
          </p>
          <textarea className="textarea" readOnly value={invoice} rows={3} />
          <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigator.clipboard.writeText(invoice)}
            >
              Copy invoice
            </button>
            {getSavedNwcUri() && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handlePayWithWallet}
                disabled={paying}
              >
                {paying ? 'Paying…' : 'Pay with connected wallet'}
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleReset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="stack">
          <p className="alert-error">{error}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleReset}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

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
  const [communityAdminPubkey, setCommunityAdminPubkey] = useState<string | null>(null)
  // Community DAOs: DAO-mode groups get a Chat | Proposals switch.
  const [tab, setTab] = useState<'chat' | 'proposals'>('chat')
  const showProposals = group.dao && tab === 'proposals'

  const viewerIsAdmin = !!activeUser && membership.isAdmin(activeUser.pubkey)
  const viewerIsMember = !!activeUser && membership.isMember(activeUser.pubkey)
  // Paid joining only actually gates posting once the group is
  // restricted AND the viewer is neither an admin nor a paid-in member —
  // an unrestricted group (the v1 default) never shows this regardless.
  const needsToJoin = group.restricted && !viewerIsAdmin && !viewerIsMember

  // Fetched lazily, only once the admin actually opens the panel — most
  // group-chat visits never need this, and it's a real relay round trip
  // (see lib/communities.ts's fetchDvmCommunityAdminPubkey).
  // Also needed by the Proposals tab: DAO labels are only trusted when
  // signed by this key (see useDaoProposals).
  const needsCommunityKey = (viewerIsAdmin && adminPanelOpen) || showProposals
  useEffect(() => {
    if (!needsCommunityKey) return
    let cancelled = false
    fetchDvmCommunityAdminPubkey().then((pk) => {
      if (!cancelled) setCommunityAdminPubkey(pk)
    })
    return () => {
      cancelled = true
    }
  }, [needsCommunityKey])

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

  // An unrestricted group (v1's original default) has no formal
  // membership concept, so "participants" there is everyone actually
  // visible: every current admin plus every distinct pubkey that's
  // posted a message. A restricted (Paid Communities) group also
  // includes the real "member" tier — paid-in pubkeys who may not have
  // posted yet. Derived from data both hooks already fetched — no new
  // subscription, no kind:39002 involved (nothing in this app ever
  // publishes that).
  const participants = useMemo<GroupParticipant[]>(() => {
    const seen = new Map<string, boolean>()
    for (const admin of membership.admins) seen.set(admin, true)
    for (const member of membership.members) if (!seen.has(member)) seen.set(member, false)
    for (const msg of messages) if (!seen.has(msg.pubkey)) seen.set(msg.pubkey, false)
    return Array.from(seen.entries()).map(([pubkey, isAdmin]) => ({ pubkey, isAdmin }))
  }, [membership.admins, membership.members, messages])

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
          restricted={group.restricted}
          dao={group.dao}
          priceSats={group.priceSats}
          payoutLud16={group.payoutLud16}
          communityAdminPubkey={communityAdminPubkey}
          busy={membership.busy}
          error={membership.error}
          onPromote={membership.promote}
          onDemote={membership.demote}
          onAddMember={membership.addMember}
          onSetDaoMode={(dao) => membership.setDaoMode(group, dao)}
          onEditMetadata={(name, about, picture) => membership.editMetadata(group, name, about, picture)}
          onSetPaidJoining={(restricted, priceSats, payoutLud16) =>
            membership.setPaidJoining(group, restricted, priceSats, payoutLud16)
          }
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

      {group.dao && (
        <div className="feed-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            className={`feed-tab${tab === 'chat' ? ' feed-tab-active' : ''}`}
            onClick={() => setTab('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'proposals'}
            className={`feed-tab${tab === 'proposals' ? ' feed-tab-active' : ''}`}
            onClick={() => setTab('proposals')}
          >
            Proposals
          </button>
        </div>
      )}

      {showProposals ? (
        <DaoProposalsView
          groupId={group.id}
          communityKeyPubkey={communityAdminPubkey}
          viewerIsAdmin={viewerIsAdmin}
          viewerCanVote={viewerIsAdmin || viewerIsMember}
          isAdmin={membership.isAdmin}
          isEligible={(pk) => membership.isAdmin(pk) || membership.isMember(pk)}
          myPubkey={activeUser?.pubkey ?? null}
        />
      ) : (
      <>
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

      {needsToJoin && !membership.isDeleted ? (
        <JoinAndPayPanel groupId={group.id} priceSats={group.priceSats} />
      ) : (
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
      )}
      </>
      )}
    </div>
  )
}
