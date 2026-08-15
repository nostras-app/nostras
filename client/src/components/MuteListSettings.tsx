import { useMuteList } from '../hooks/useMuteList'
import { useProfile } from '../hooks/useProfile'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'

function MutedRow({
  pubkey,
  busy,
  onUnmute,
}: {
  pubkey: string
  busy: boolean
  onUnmute: (pubkey: string) => void
}) {
  const profile = useProfile(pubkey)
  const label = profile?.name || profile?.displayName || `${pubkey.slice(0, 12)}…`

  return (
    <li className="linked-account-row">
      <button
        type="button"
        className="feed-item-avatar-btn"
        onClick={() => viewProfile(pubkey)}
        title={`View ${label}'s profile`}
      >
        {isSecureImageUrl(profile?.picture) ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <span className="avatar-fallback">{label.charAt(0)}</span>
        )}
      </button>
      <button type="button" className="feed-item-name-btn follow-list-name-btn" onClick={() => viewProfile(pubkey)}>
        <span className="feed-item-name">{label}</span>
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onUnmute(pubkey)}
        disabled={busy}
      >
        {busy ? '…' : 'Unmute'}
      </button>
    </li>
  )
}

// Real, user-reported gap (2026-08-15): muting someone (NoteMenu's "Mute
// user") published a real NIP-51 kind:10000 list correctly, but there was
// nowhere to actually see or manage that list afterward — no way to
// review who's muted or undo it except re-finding that exact note's own
// menu again. Reuses useMuteList (the same hook NoteMenu now shares,
// after being extracted from what used to be NoteMenu's own inline
// fetch-then-republish logic) so both surfaces stay in sync with the
// real list, not two independent copies of similar logic.
export function MuteListSettings() {
  const { pubkeys, busy, loading, error, toggle } = useMuteList()

  return (
    <div className="stack">
      <p className="field-hint">
        People you've muted (NIP-51, kind:10000). Their notes are hidden
        from your Following and Global feeds — muting doesn't notify
        them, and it doesn't affect a profile you visit directly.
      </p>

      {loading ? (
        <p className="field-hint">Loading…</p>
      ) : pubkeys.length === 0 ? (
        <p className="field-hint">Nobody muted.</p>
      ) : (
        <ul className="linked-accounts-list">
          {pubkeys.map((pubkey) => (
            <MutedRow key={pubkey} pubkey={pubkey} busy={busy === pubkey} onUnmute={toggle} />
          ))}
        </ul>
      )}

      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
