import { normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import { useRelayList } from '../hooks/useRelayList'
import { relayStatusLabel } from '../lib/relayList'
import { localRelayUrl } from '../lib/ndk'

const normalizedLocalRelayUrl = normalizeRelayUrl(localRelayUrl)

export function RelaySettings() {
  const relays = useRelayList()

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
          return (
            <div key={relay.url} className="relay-row">
              <span className="status-dot-standalone" data-state={label} />
              <span className="relay-url">{relay.url}</span>
              {isLocal && <span className="relay-badge">local</span>}
              <span className="relay-status-label" data-state={label}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
