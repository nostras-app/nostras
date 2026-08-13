import { useState } from 'react'
import { normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import { useRelayList } from '../hooks/useRelayList'
import { relayStatusLabel, refreshRelayList } from '../lib/relayList'
import { usePublishTargets } from '../hooks/usePublishTargets'
import { isPublishTarget, togglePublishTarget } from '../lib/publishTargets'
import { ndk, localRelayUrl, devPublishRelaySet } from '../lib/ndk'
import {
  getCustomRelays,
  addCustomRelayUrl,
  removeCustomRelayUrl,
  isValidRelayUrl,
} from '../lib/customRelays'
import { publishCurrentPreferences } from '../lib/appData'
import { UploadIcon } from './icons'

const normalizedLocalRelayUrl = normalizeRelayUrl(localRelayUrl)

export function RelaySettings() {
  const relays = useRelayList()
  usePublishTargets() // subscribes so publish-target toggles re-render this list, including the summary below
  const publishCount = devPublishRelaySet.relays.size
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
    // Real user-reported friction (2026-08-11): a manually-added custom
    // relay previously still needed its own separate publish-target
    // toggle click every session — annoying for a relay the user just
    // went out of their way to add on purpose. Auto-enabling here is
    // safe and doesn't touch the underlying safety property (session-only,
    // resets on reload): it only fires for this explicit "Add relay"
    // action, never for a relay that merely appears in the pool on its
    // own (NIP-65 outbox discovery still starts opted-out, exactly as
    // before). `added` is always freshly off here (it can't already be a
    // publish target — it didn't exist a moment ago), so this is always a
    // plain on-toggle, never an accidental turn-off.
    togglePublishTarget(added)
    refreshRelayList()
    setCustomRelays(getCustomRelays())
    setInput('')
    setError(null)
    // NIP-78: fire-and-forget, same reasoning as Feed.tsx's feed-mode
    // sync — a failure here doesn't undo the relay that was just added
    // locally, it just means this device's change doesn't reach other
    // devices this time.
    publishCurrentPreferences().catch(() => {})
  }

  function handleRemove(url: string) {
    removeCustomRelayUrl(url)
    ndk.pool.removeRelay(url)
    refreshRelayList()
    setCustomRelays(getCustomRelays())
    publishCurrentPreferences().catch(() => {})
  }

  return (
    <div className="stack">
      <div className="relay-publish-summary">
        <UploadIcon />
        <span>
          <strong>
            Publishing to {publishCount} relay{publishCount === 1 ? '' : 's'}
          </strong>{' '}
          — this is where a note you write actually ends up. The upload icon
          next to each relay below shows which ones are currently included;
          click it to add or remove a relay from this list.
        </span>
      </div>
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
        {import.meta.env.PROD
          ? "This starts, every session, with NOSTRAS's own relay plus a couple of well-known public relays — so a note you publish reaches the wider Nostr network by default, not just this app. Any relay you add or remove above only applies for this session; it's not saved, so it resets back to that same default on reload rather than silently remembering a one-off choice."
          : 'The upload icon controls where new notes get published this session (always includes the local relay). This choice is not saved — it resets to local-only on reload, so nothing gets broadcast to the public network without opting in again each time. (This is the local-dev build; the deployed app defaults to local + public relays instead.)'}
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
