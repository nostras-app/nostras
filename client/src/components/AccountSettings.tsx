import { logOff } from '../lib/authState'

export function AccountSettings() {
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
    </div>
  )
}
