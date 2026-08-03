import { useEffect, useState } from 'react'
import {
  connectBunker,
  connectExtension,
  disconnectSigner,
  getSavedSignerMode,
  hasNip07Extension,
  restoreSignerSession,
} from '../lib/remoteSigner'
import { useActiveUser } from '../hooks/useActiveUser'

type Status = 'dev' | 'connecting' | 'connected' | 'error'

export function SignerConnect() {
  const activeUser = useActiveUser()
  const [status, setStatus] = useState<Status>('dev')
  const [uri, setUri] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!getSavedSignerMode()) return
    setStatus('connecting')
    restoreSignerSession()
      .then((result) => setStatus(result ? 'connected' : 'dev'))
      .catch((e) => {
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Failed to reconnect')
      })
  }, [])

  async function handleConnectBunker() {
    if (!uri.trim()) return
    setStatus('connecting')
    setError(null)
    try {
      await connectBunker(uri.trim())
      setStatus('connected')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Failed to connect')
    }
  }

  async function handleConnectExtension() {
    setStatus('connecting')
    setError(null)
    try {
      await connectExtension()
      setStatus('connected')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Failed to connect extension')
    }
  }

  function handleDisconnect() {
    disconnectSigner()
    setStatus('dev')
    setUri('')
    setError(null)
  }

  if (status === 'connected') {
    return (
      <div className="field-row" style={{ alignItems: 'center' }}>
        <p className="field-hint" style={{ flex: 1 }}>
          Connected as {activeUser?.npub.slice(0, 16)}…
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleDisconnect}
        >
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="stack">
      <p className="field-hint">
        Signing with a temporary local dev key. Connect a real signer
        instead:
      </p>
      <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleConnectExtension}
          disabled={status === 'connecting' || !hasNip07Extension()}
          title={
            hasNip07Extension()
              ? undefined
              : 'No NIP-07 browser extension detected (e.g. Alby, nos2x)'
          }
        >
          {status === 'connecting'
            ? 'Connecting…'
            : hasNip07Extension()
              ? 'Connect browser extension (NIP-07)'
              : 'No extension detected'}
        </button>
      </div>
      <div className="field-row">
        <input
          className="input"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder="bunker://... (NIP-46)"
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleConnectBunker}
          disabled={status === 'connecting' || !uri.trim()}
        >
          {status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
