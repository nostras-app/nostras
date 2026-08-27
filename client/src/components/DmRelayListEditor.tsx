import { useEffect, useState } from 'react'
import { normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import { useDmRelayList } from '../hooks/useDmRelayList'
import { isValidRelayUrl } from '../lib/customRelays'

export function DmRelayListEditor() {
  const { entries, save, busy, error: saveError } = useDmRelayList()
  const [draft, setDraft] = useState<string[] | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraft(entries)
  }, [entries])

  if (!draft) return null

  function removeEntry(url: string) {
    setDraft((prev) => prev && prev.filter((e) => e !== url))
    setSaved(false)
  }

  function handleAdd() {
    const trimmed = input.trim()
    if (!isValidRelayUrl(trimmed)) {
      setError('Enter a valid ws:// or wss:// relay URL.')
      return
    }
    const normalized = normalizeRelayUrl(trimmed)
    if (draft?.includes(normalized)) {
      setError('That relay is already in the list.')
      return
    }
    setDraft((prev) => [...(prev ?? []), normalized])
    setInput('')
    setError(null)
    setSaved(false)
  }

  async function handleSave() {
    if (!draft) return
    const ok = await save(draft)
    setSaved(ok)
  }

  return (
    <div className="stack">
      <p className="field-hint">
        Where NIP-17-aware clients should deliver direct messages to you —
        deliberately separate from your general NIP-65 relays above, since
        keeping DM traffic off your regular read/write relays is exactly
        what NIP-17's gift-wrapping is designed to protect. Publishes using
        the current session's publish targets (local-only by default).
      </p>
      <div className="nip65-list">
        {draft.map((url) => (
          <div key={url} className="relay-row">
            <span className="relay-url">{url}</span>
            <button
              type="button"
              className="relay-remove-btn"
              onClick={() => removeEntry(url)}
              aria-label={`Remove ${url}`}
              title="Remove relay"
            >
              &times;
            </button>
          </div>
        ))}
        {draft.length === 0 && <p className="field-hint">No DM relays set yet.</p>}
      </div>
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
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleSave}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Save DM relay list'}
        </button>
        {saved && <span className="field-hint">Saved.</span>}
      </div>
      {saveError && <p className="alert-error">{saveError}</p>}
    </div>
  )
}
