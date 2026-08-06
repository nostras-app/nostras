import { CLIENT_VERSION } from '../lib/version'
import { useRelayVersion } from '../hooks/useRelayVersion'

// Answers "which version am I running" for both sides at once — the
// client build's own git SHA (baked in at build time) and the connected
// relay's NIP-11 `version` field (fetched live, standard protocol
// mechanism, not NOSTRAS-specific). Deliberately plain/unobtrusive here
// rather than prominent — this is a support/debugging detail, not
// something most users need to think about, but it should be easy to
// find when a bug report needs it.
export function AboutSettings() {
  const relayVersion = useRelayVersion()

  return (
    <div className="stack">
      <p className="field-hint">
        Client build: <code>{CLIENT_VERSION}</code>
        <br />
        Relay version: <code>{relayVersion ?? '…'}</code>
      </p>
    </div>
  )
}
