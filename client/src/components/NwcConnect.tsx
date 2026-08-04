import { useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import { clearNwcUri, getSavedNwcUri, saveNwcUri, parseNwcUri } from '../lib/nwc'

// Truncated npub + relay host, parsed straight from the saved connection
// string — this is real, always-present identifying info (every valid
// NWC URI has a wallet pubkey and a relay), not something the wallet has
// to separately opt into exposing. Falls back to a generic label if the
// stored string is somehow no longer parseable.
function describeConnection(uri: string): string {
  try {
    const { walletPubkey, relay } = parseNwcUri(uri)
    const npub = nip19.npubEncode(walletPubkey)
    const host = new URL(relay).host
    return `${npub.slice(0, 12)}…  via ${host}`
  } catch {
    return 'Wallet connected (NWC)'
  }
}

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
          {describeConnection(savedUri)}
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
