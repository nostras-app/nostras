import { CLIENT_VERSION } from '../lib/version'
import { useRelayVersion } from '../hooks/useRelayVersion'
import { useServiceWorkerUpdate } from '../hooks/useServiceWorkerUpdate'

// Answers "which version am I running" for both sides at once — the
// client build's own git SHA (baked in at build time) and the connected
// relay's NIP-11 `version` field (fetched live, standard protocol
// mechanism, not NOSTRAS-specific). Deliberately plain/unobtrusive here
// rather than prominent — this is a support/debugging detail, not
// something most users need to think about, but it should be easy to
// find when a bug report needs it.
export function AboutSettings() {
  const relayVersion = useRelayVersion()
  const { status: swStatus, error: swError, checkForUpdate } = useServiceWorkerUpdate()

  return (
    <div className="stack">
      <p className="field-hint">
        Client build: <code>{CLIENT_VERSION}</code>
        <br />
        Relay version: <code>{relayVersion ?? '…'}</code>
      </p>
      {swStatus !== 'unsupported' && (
        <div className="field-row" style={{ alignItems: 'center' }}>
          <p className="field-hint" style={{ flex: 1 }}>
            {swStatus === 'updating'
              ? 'Update found — applying now, the app will reload shortly.'
              : swStatus === 'up-to-date'
                ? "You're on the latest version."
                : 'Installed apps only check for updates periodically — check manually if you think a newer version is out.'}
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={checkForUpdate}
            disabled={swStatus === 'checking' || swStatus === 'updating'}
          >
            {swStatus === 'checking'
              ? 'Checking…'
              : swStatus === 'updating'
                ? 'Updating…'
                : 'Check for updates'}
          </button>
        </div>
      )}
      {swError && <p className="alert-error">{swError}</p>}
    </div>
  )
}
