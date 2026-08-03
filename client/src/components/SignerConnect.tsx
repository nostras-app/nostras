import { useEffect, useState } from 'react'
import {
  connectBunker,
  disconnectRemoteSigner,
  getSavedRemoteSignerSession,
  restoreRemoteSignerSession,
} from '../lib/remoteSigner'
import { useActiveUser } from '../hooks/useActiveUser'

type Status = 'dev' | 'connecting' | 'connected' | 'error'

export function SignerConnect() {
  const activeUser = useActiveUser()
  const [status, setStatus] = useState<Status>('dev')
  const [uri, setUri] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!getSavedRemoteSignerSession()) return
    setStatus('connecting')
    restoreRemoteSignerSession()
      .then((user) => setStatus(user ? 'connected' : 'dev'))
      .catch((e) => {
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Failed to reconnect')
      })
  }, [])

  async function handleConnect() {
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

  function handleDisconnect() {
    disconnectRemoteSigner()
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
        Signing with a temporary local dev key. Connect a NIP-46 remote
        signer (bunker) instead:
      </p>
      <input
        value={uri}
        onChange={(e) => setUri(e.target.value)}
        placeholder="bunker://..."
      />
      <button
        type="button"
        onClick={handleConnect}
        disabled={status === 'connecting' || !uri.trim()}
      >
        {status === 'connecting' ? 'Connecting…' : 'Connect'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
