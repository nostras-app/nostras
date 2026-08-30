import { useEffect, useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import { clearNwcUri, getSavedNwcUri, saveNwcUri, parseNwcUri } from '../lib/nwc'
import { useActiveUser } from '../hooks/useActiveUser'

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
  const activeUser = useActiveUser()
  const [savedUri, setSavedUri] = useState(getSavedNwcUri())
  const [input, setInput] = useState('')

  // getSavedNwcUri() itself already resolves the *current* active
  // identity — this just re-reads it whenever that identity actually
  // changes, so switching identities in Settings shows that identity's
  // own connection (or the empty state) instead of the previous one.
  useEffect(() => {
    setSavedUri(getSavedNwcUri())
    setInput('')
  }, [activeUser?.pubkey])

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

  return (
    <div className="stack">
      <p className="field-hint">
        <strong>NWC</strong> (Nostr Wallet Connect —{' '}
        <a href="https://github.com/nostr-protocol/nips/blob/master/47.md" target="_blank" rel="noreferrer">
          NIP-47
        </a>
        ) lets NOSTRAS ask a real Lightning wallet you control to create and
        pay invoices, without NOSTRAS ever holding your keys or funds. The
        wallet itself stays wherever you actually run it — Alby, Mutiny, your
        own node — NOSTRAS only ever sends it a signed request over Nostr
        relays and reads back the response. This is what powers zaps (
        <a href="https://github.com/nostr-protocol/nips/blob/master/57.md" target="_blank" rel="noreferrer">
          NIP-57
        </a>
        ) and every other paid feature in this app. Real Bitcoin over the
        real Lightning Network — not a test network, unlike the Ark wallet
        below.
      </p>
      {savedUri ? (
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
      ) : (
        <div className="stack">
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
          <p className="field-hint">
            Don't have a wallet that speaks NWC yet? See{' '}
            <a href="https://nostras.app/wallet" target="_blank" rel="noreferrer">
              how to run your own self-custodial one
            </a>
            .
          </p>
        </div>
      )}
    </div>
  )
}
