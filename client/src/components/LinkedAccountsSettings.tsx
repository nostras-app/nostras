import { useState } from 'react'
import { useMyExternalIdentities } from '../hooks/useMyExternalIdentities'
import { EXTERNAL_IDENTITY_PLATFORMS, externalIdentityProfileUrl } from '../lib/externalIdentities'

// NIP-39 external identities editor — a real, previously-flagged gap:
// nothing let a user claim/show a linked GitHub/Twitter/Mastodon/
// Telegram account. Deliberately not independently verified client-side
// (that would mean fetching and parsing a gist/tweet/post per platform,
// a real but separate feature) — these are shown as the user's own
// claim, same honesty-about-scope posture as NIP-05 verification
// elsewhere in this app, which *does* independently verify (the
// difference is stated plainly in the UI below, not glossed over).
export function LinkedAccountsSettings() {
  const { identities, addIdentity, removeIdentity, busy, loading, error } = useMyExternalIdentities()
  const [platform, setPlatform] = useState<string>(EXTERNAL_IDENTITY_PLATFORMS[0].id)
  const [identity, setIdentity] = useState('')
  const [proof, setProof] = useState('')

  const platformInfo = EXTERNAL_IDENTITY_PLATFORMS.find((p) => p.id === platform) ?? EXTERNAL_IDENTITY_PLATFORMS[0]

  async function handleAdd() {
    if (!identity.trim() || !proof.trim()) return
    const ok = await addIdentity(platform, identity.trim().toLowerCase(), proof.trim())
    if (ok) {
      setIdentity('')
      setProof('')
    }
  }

  return (
    <div className="stack">
      <p className="field-hint">
        Linked accounts (NIP-39): claim a GitHub, Twitter/X, Mastodon, or
        Telegram identity on your profile. NOSTRAS shows these as your
        own claim — it doesn't independently verify the proof (unlike
        the NIP-05 checkmark above), so treat them the same way you'd
        treat an unverified link anywhere else.
      </p>

      {loading ? (
        <p className="field-hint">Loading…</p>
      ) : identities.length === 0 ? (
        <p className="field-hint">No linked accounts yet.</p>
      ) : (
        <ul className="linked-accounts-list">
          {identities.map((id) => {
            const url = externalIdentityProfileUrl(id.platform, id.identity)
            const label = EXTERNAL_IDENTITY_PLATFORMS.find((p) => p.id === id.platform)?.label ?? id.platform
            return (
              <li key={`${id.platform}:${id.identity}`} className="linked-account-row">
                <span className="linked-account-platform">{label}</span>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="note-link">
                    {id.identity}
                  </a>
                ) : (
                  <span>{id.identity}</span>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => removeIdentity(id.platform, id.identity)}
                  disabled={busy}
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="alert-error">{error}</p>}

      <div className="btn-row">
        {EXTERNAL_IDENTITY_PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`btn btn-sm ${platform === p.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setPlatform(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        className="input"
        value={identity}
        onChange={(e) => setIdentity(e.target.value)}
        placeholder={platformInfo.identityHint}
      />
      <input
        className="input"
        value={proof}
        onChange={(e) => setProof(e.target.value)}
        placeholder={platformInfo.proofHint}
      />
      <p className="field-hint">{platformInfo.proofHelp(identity)}</p>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleAdd}
          disabled={busy || loading || !identity.trim() || !proof.trim()}
        >
          {busy ? 'Saving…' : 'Add linked account'}
        </button>
      </div>
    </div>
  )
}
