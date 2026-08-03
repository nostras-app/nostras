import { useState } from 'react'
import { clearNwcUri, getSavedNwcUri, saveNwcUri } from '../lib/nwc'

export function NwcConnect() {
  const [savedUri, setSavedUri] = useState(getSavedNwcUri())
  const [input, setInput] = useState('')

  function handleConnect() {
    if (!input.trim()) return
    saveNwcUri(input.trim())
    setSavedUri(input.trim())
    setInput('')
  }

  function handleDisconnect() {
    clearNwcUri()
    setSavedUri(null)
  }

  if (savedUri) {
    return (
      <div className="field-row" style={{ alignItems: 'center' }}>
        <p className="field-hint" style={{ flex: 1 }}>
          Wallet connected (NWC)
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleDisconnect}
        >
          Disconnect wallet
        </button>
      </div>
    )
  }

  return (
    <div className="field-row">
      <input
        className="input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="nostr+walletconnect://..."
      />
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={handleConnect}
        disabled={!input.trim()}
      >
        Connect wallet
      </button>
    </div>
  )
}
