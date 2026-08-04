import { useState } from 'react'
import { normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import { useRelayList } from '../hooks/useRelayList'
import { relayStatusLabel, refreshRelayList } from '../lib/relayList'
import { usePublishTargets } from '../hooks/usePublishTargets'
import { isPublishTarget, togglePublishTarget } from '../lib/publishTargets'
import { ndk, localRelayUrl } from '../lib/ndk'
import {
  getCustomRelays,
  addCustomRelayUrl,
  removeCustomRelayUrl,
  isValidRelayUrl,
} from '../lib/customRelays'
import { UploadIcon } from './icons'

const normalizedLocalRelayUrl = normalizeRelayUrl(localRelayUrl)

export function RelaySettings() {
  const relays = useRelayList()
  usePublishTargets() // subscribes so publish-target toggles re-render this list
  const [customRelays, setCustomRelays] = useState(getCustomRelays)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleAdd() {
    const trimmed = input.trim()
    if (!isValidRelayUrl(trimmed)) {
      setError('Enter a valid ws:// or wss:// relay URL.')
      return
    }
    const added = addCustomRelayUrl(trimmed)
    if (!added) {
      setError('That relay is already added.')
      return
    }
    ndk.pool.getRelay(added, true)
    refreshRelayList()
    setCustomRelays(getCustomRelays())
    setInput('')
    setError(null)
  }

  function handleRemove(url: string) {
    removeCustomRelayUrl(url)
    ndk.pool.removeRelay(url)
    refreshRelayList()
    setCustomRelays(getCustomRelays())
  }

  return (
    <div className="stack">
      <p className="field-hint">
        Includes relays discovered automatically while fetching content
        (NIP-65 outbox lookups), not just the ones configured at startup —
        this list can grow and shrink on its own.
      </p>
      <div className="relay-list">
        {relays.map((relay) => {
          const label = relayStatusLabel(relay.status)
          const isLocal = relay.url === normalizedLocalRelayUrl
          const isCustom = customRelays.includes(relay.url)
          const publishing = isPublishTarget(relay.url)
          return (
            <div key={relay.url} className="relay-row">
              <span className="status-dot-standalone" data-state={label} />
              <span className="relay-url">{relay.url}</span>
              {isLocal && <span className="relay-badge">local</span>}
              {isCustom && <span className="relay-badge">custom</span>}
              <span className="relay-status-label" data-state={label}>
                {label}
              </span>
              <button
                type="button"
                className="relay-publish-btn"
                aria-pressed={publishing}
                aria-label={
                  isLocal
                    ? `${relay.url} always receives published notes`
                    : `Toggle publishing notes to ${relay.url}`
                }
                title={
                  isLocal
                    ? 'Always a publish target'
                    : publishing
                      ? 'Publishing here — click to stop'
                      : 'Not a publish target — click to include'
                }
                disabled={isLocal}
                onClick={() => togglePublishTarget(relay.url)}
              >
                <UploadIcon />
              </button>
              {isCustom && (
                <button
                  type="button"
                  className="relay-remove-btn"
                  onClick={() => handleRemove(relay.url)}
                  aria-label={`Remove ${relay.url}`}
                  title="Remove relay"
                >
                  &times;
                </button>
              )}
            </div>
          )
        })}
      </div>
      <p className="field-hint">
        The upload icon controls where new notes get published this session
        (always includes the local relay). This choice is not saved —
        it resets to local-only on reload, so nothing gets broadcast to the
        public network without opting in again each time.
      </p>
      <div className="relay-add-row">
        <input
          type="text"
          className="input"
          placeholder="wss://relay.example.com"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={handleAdd}>
          Add relay
        </button>
      </div>
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
