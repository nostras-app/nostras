import { useEffect, useState } from 'react'
import { useNip65RelayList, type Nip65Entry } from '../hooks/useNip65RelayList'
import { isValidRelayUrl } from '../lib/customRelays'
import { normalizeRelayUrl } from '@nostr-dev-kit/ndk'

export function Nip65RelayListEditor() {
  const { entries, save, busy, error: saveError } = useNip65RelayList()
  const [draft, setDraft] = useState<Nip65Entry[] | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraft(entries)
  }, [entries])

  if (!draft) return null

  function updateEntry(url: string, patch: Partial<Nip65Entry>) {
    setDraft((prev) => prev && prev.map((e) => (e.url === url ? { ...e, ...patch } : e)))
    setSaved(false)
  }

  function removeEntry(url: string) {
    setDraft((prev) => prev && prev.filter((e) => e.url !== url))
    setSaved(false)
  }

  function handleAdd() {
    const trimmed = input.trim()
    if (!isValidRelayUrl(trimmed)) {
      setError('Enter a valid ws:// or wss:// relay URL.')
      return
    }
    const normalized = normalizeRelayUrl(trimmed)
    if (draft?.some((e) => e.url === normalized)) {
      setError('That relay is already in the list.')
      return
    }
    setDraft((prev) => [...(prev ?? []), { url: normalized, read: true, write: true }])
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
        Publishes where you read and write notes (NIP-65), so other clients
        and relays can find your posts. Publishes using the current
        session's publish targets above (local-only by default).
      </p>
      <div className="nip65-list">
        {draft.map((entry) => (
          <div key={entry.url} className="relay-row">
            <span className="relay-url">{entry.url}</span>
            <label className="nip65-check">
              <input
                type="checkbox"
                checked={entry.read}
                onChange={(e) => updateEntry(entry.url, { read: e.target.checked })}
              />
              read
            </label>
            <label className="nip65-check">
              <input
                type="checkbox"
                checked={entry.write}
                onChange={(e) => updateEntry(entry.url, { write: e.target.checked })}
              />
              write
            </label>
            <button
              type="button"
              className="relay-remove-btn"
              onClick={() => removeEntry(entry.url)}
              aria-label={`Remove ${entry.url}`}
              title="Remove relay"
            >
              &times;
            </button>
          </div>
        ))}
        {draft.length === 0 && <p className="field-hint">No relays in your list yet.</p>}
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
          {busy ? 'Saving…' : 'Save relay list'}
        </button>
        {saved && <span className="field-hint">Saved.</span>}
      </div>
      {saveError && <p className="alert-error">{saveError}</p>}
    </div>
  )
}
