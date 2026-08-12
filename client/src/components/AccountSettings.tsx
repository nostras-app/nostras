import { useState } from 'react'
import { logOff } from '../lib/authState'
import { requestVanish } from '../lib/vanish'

export function AccountSettings() {
  const [confirmingVanish, setConfirmingVanish] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleVanish() {
    setBusy(true)
    setError(null)
    try {
      await requestVanish()
      // The identity's data on NOSTRAS's relay is gone (or about to be
      // — server-side deletion runs right after this request lands),
      // so there's nothing useful left to show for it here. logOff()
      // returns to the initial choice screen, same as a normal log off
      // — the local key itself is untouched by this (see Settings >
      // Identities to remove it from this browser too, a separate
      // action).
      logOff()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the vanish request')
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <p className="field-hint">
        Signs you out of this identity and returns to the initial
        choice screen (log in, create a new account, or continue
        anonymously). Your key isn't deleted — choosing the same option
        again restores this exact identity.
      </p>
      <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={logOff}>
          Log off
        </button>
      </div>

      <p className="field-hint">
        Request to vanish (NIP-62): asks NOSTRAS's own relay to
        permanently delete every note, profile update, and other event
        you've published here, plus any direct messages sent to you —
        and to refuse to ever store any of it again. This only affects
        NOSTRAS's relay; copies your content already reached on other
        relays aren't touched, and this doesn't delete your key or
        settings from this browser (Settings &gt; Identities does
        that, separately). There's no undo.
      </p>

      {confirmingVanish ? (
        <div className="stack">
          <p className="alert-error">
            This is permanent. NOSTRAS's relay will erase your data and
            refuse to store it again — are you sure?
          </p>
          {error && <p className="alert-error">{error}</p>}
          <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setConfirmingVanish(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={handleVanish} disabled={busy}>
              {busy ? 'Sending…' : 'Yes, vanish my data'}
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmingVanish(true)}>
            Vanish my data
          </button>
        </div>
      )}
    </div>
  )
}
