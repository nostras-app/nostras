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
      <div>
        <p>Remote signer connected as {activeUser?.npub}</p>
        <button type="button" onClick={handleDisconnect}>
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div>
      <p>
        Signing with a temporary local dev key. Connect a real signer
        instead:
      </p>
      <button
        type="button"
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
      <div>
        <input
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder="bunker://... (NIP-46)"
        />
        <button
          type="button"
          onClick={handleConnectBunker}
          disabled={status === 'connecting' || !uri.trim()}
        >
          {status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
