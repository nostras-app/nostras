import { useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { isSecureImageUrl } from '../lib/parseContent'

function AdminRow({
  pubkey,
  canDemote,
  busy,
  onDemote,
}: {
  pubkey: string
  canDemote: boolean
  busy: boolean
  onDemote: (pubkey: string) => void
}) {
  const profile = useProfile(pubkey)
  const label = profile?.name || profile?.displayName || `${nip19.npubEncode(pubkey).slice(0, 12)}…`

  return (
    <li className="follow-list-row">
      {isSecureImageUrl(profile?.picture) ? (
        <img className="avatar" src={profile.picture} alt="" />
      ) : (
        <span className="avatar-fallback">{label.charAt(0)}</span>
      )}
      <span className="feed-item-name-btn follow-list-name-btn">
        <span className="feed-item-name">{label}</span>
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onDemote(pubkey)}
        disabled={busy || !canDemote}
        title={canDemote ? 'Remove admin' : "A group needs at least one admin — can't demote the last one"}
      >
        {busy ? '…' : 'Demote'}
      </button>
    </li>
  )
}

// Rendered only when the active user is a current admin (GroupChatView's
// own isAdmin(activeUser.pubkey) check gates this, not this component
// itself). "Remove member" is deliberately scoped to admin demotion only
// (kind:9001 as the inverse of kind:9000) — v1 has no membership-gated
// posting, so a button implying a real kick/ban would promise a
// capability this version doesn't actually have. Real kick/ban is a
// closed-groups-phase feature.
export function GroupAdminPanel({
  name,
  about,
  picture,
  admins,
  restricted,
  priceSats,
  payoutLud16,
  communityAdminPubkey,
  busy,
  error,
  onPromote,
  onDemote,
  onEditMetadata,
  onSetPaidJoining,
  onDeleteGroup,
}: {
  name: string
  about: string
  picture: string
  admins: string[]
  restricted: boolean
  priceSats: number
  payoutLud16: string
  // The DVM's persisted community-admin pubkey, fetched from its own
  // NIP-89 announcement — null while looking it up, or if paid
  // communities aren't configured on the DVM at all right now.
  communityAdminPubkey: string | null
  busy: string | null
  error: string | null
  onPromote: (pubkey: string) => void
  onDemote: (pubkey: string) => void
  onEditMetadata: (name: string, about: string, picture: string) => void
  onSetPaidJoining: (restricted: boolean, priceSats: number, payoutLud16: string) => void
  onDeleteGroup: () => void
}) {
  const [editName, setEditName] = useState(name)
  const [editAbout, setEditAbout] = useState(about)
  const [editPicture, setEditPicture] = useState(picture)
  const [promoteInput, setPromoteInput] = useState('')
  const [promoteError, setPromoteError] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deletingGroup = busy === 'delete-group'
  const paidJoiningBusy = busy === 'paid-joining'

  const [paidEnabled, setPaidEnabled] = useState(restricted)
  const [priceInput, setPriceInput] = useState(priceSats > 0 ? String(priceSats) : '')
  const [payoutInput, setPayoutInput] = useState(payoutLud16)
  const communityAdminIsPromoted = !!communityAdminPubkey && admins.includes(communityAdminPubkey)

  function handleSavePaidJoining() {
    const parsedPrice = Number(priceInput)
    onSetPaidJoining(paidEnabled, paidEnabled ? parsedPrice : 0, paidEnabled ? payoutInput.trim() : '')
  }

  function handlePromote() {
    const trimmed = promoteInput.trim()
    if (!trimmed) return
    try {
      const decoded = nip19.decode(trimmed)
      if (decoded.type !== 'npub') throw new Error('not an npub')
      onPromote(decoded.data)
      setPromoteInput('')
      setPromoteError(false)
    } catch {
      setPromoteError(true)
    }
  }

  return (
    <div className="group-admin-panel">
      <p className="field-hint">Group admin tools — visible only to admins.</p>

      <div className="communities-create-form">
        <input
          className="input"
          placeholder="Group name"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
        />
        <textarea
          className="textarea"
          placeholder="About (optional)"
          value={editAbout}
          onChange={(e) => setEditAbout(e.target.value)}
          rows={2}
        />
        <input
          className="input"
          placeholder="Picture URL (optional)"
          value={editPicture}
          onChange={(e) => setEditPicture(e.target.value)}
        />
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onEditMetadata(editName, editAbout, editPicture)}
            disabled={busy === 'metadata' || !editName.trim()}
          >
            {busy === 'metadata' ? 'Saving…' : 'Save metadata'}
          </button>
        </div>
      </div>

      <div className="communities-create-form group-admin-paid-joining">
        <label className="article-paywall-toggle">
          <input
            type="checkbox"
            checked={paidEnabled}
            onChange={(e) => setPaidEnabled(e.target.checked)}
          />
          Require payment to post (paid joining)
        </label>

        {paidEnabled && (
          <div className="stack">
            <input
              className="input"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              placeholder="Price in sats (e.g. 250)"
              inputMode="numeric"
            />
            <input
              className="input"
              value={payoutInput}
              onChange={(e) => setPayoutInput(e.target.value)}
              placeholder="Payout Lightning address (name@domain) — where join payments go"
            />
            <p className="field-hint">
              Anyone can still read this group's chat — paying only removes the posting gate.
              Payment goes straight to the address above, plus a small flat fee to NOSTRAS for
              running the join service. For paid joining to actually work, NOSTRAS's DVM also
              needs to be an admin of this group —{' '}
              {communityAdminPubkey ? (
                communityAdminIsPromoted ? (
                  <strong>it already is, promoted below.</strong>
                ) : (
                  <>
                    promote <code>{nip19.npubEncode(communityAdminPubkey).slice(0, 16)}…</code>{' '}
                    using the promote box below.
                  </>
                )
              ) : (
                'the DVM has not advertised a community-admin key yet, so paid joining is not available right now.'
              )}
            </p>
          </div>
        )}

        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSavePaidJoining}
            disabled={
              paidJoiningBusy ||
              (paidEnabled && (!priceInput.trim() || Number(priceInput) <= 0 || !payoutInput.trim()))
            }
          >
            {paidJoiningBusy ? 'Saving…' : 'Save paid joining settings'}
          </button>
        </div>
      </div>

      <div className="field-row">
        <input
          className="input"
          value={promoteInput}
          onChange={(e) => {
            setPromoteInput(e.target.value)
            setPromoteError(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && handlePromote()}
          placeholder="npub1… — promote to admin"
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handlePromote}
          disabled={!promoteInput.trim() || !!busy}
        >
          Promote
        </button>
      </div>
      {promoteError && <p className="alert-error">That doesn't look like a valid npub.</p>}

      <ul className="follow-list">
        {admins.map((pubkey) => (
          <AdminRow
            key={pubkey}
            pubkey={pubkey}
            canDemote={admins.length > 1}
            busy={busy === pubkey}
            onDemote={onDemote}
          />
        ))}
      </ul>

      {error && <p className="alert-error">{error}</p>}

      <div className="group-admin-danger-zone">
        {!confirmingDelete ? (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => setConfirmingDelete(true)}
            disabled={!!busy}
          >
            Delete group
          </button>
        ) : (
          <div className="stack">
            <span className="translate-panel-label">
              Delete this group? This stops any new messages or moderation
              from being accepted — it does not erase existing messages
              already stored on the relay, and can't be undone.
            </span>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmingDelete(false)}
                disabled={deletingGroup}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={onDeleteGroup}
                disabled={deletingGroup}
              >
                {deletingGroup ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
