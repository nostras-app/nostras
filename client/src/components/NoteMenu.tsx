import { useEffect, useRef, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKEvent as NDKEventType } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { MoreIcon } from './icons'

const REPORT_TYPES: { value: string; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'nudity', label: 'Nudity' },
  { value: 'profanity', label: 'Profanity' },
  { value: 'illegal', label: 'Illegal' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'malware', label: 'Malware' },
  { value: 'other', label: 'Other' },
]

type Panel = 'menu' | 'raw' | 'report'

export function NoteMenu({ event }: { event: NDKEventType }) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [copied, setCopied] = useState('')
  const [reported, setReported] = useState(false)
  const [muted, setMuted] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panel === 'menu' && rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPanel(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [panel])

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setPanel(null)
    setTimeout(() => setCopied(''), 1500)
  }

  async function handleReport(reportType: string) {
    if (busy) return
    setBusy(true)
    try {
      const report = new NDKEvent(ndk, {
        kind: 1984,
        content: '',
        tags: [
          ['e', event.id, reportType],
          ['p', event.pubkey, reportType],
        ],
      })
      await report.publish(devPublishRelaySet)
      setReported(true)
      setPanel(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleMute() {
    if (busy || muted) return
    setBusy(true)
    try {
      const existing = await ndk.fetchEvent({
        kinds: [10000],
        authors: [ndk.activeUser?.pubkey ?? ''],
      })
      const existingTags = existing?.tags ?? []
      const alreadyMuted = existingTags.some(
        (t) => t[0] === 'p' && t[1] === event.pubkey,
      )
      if (!alreadyMuted) {
        const updated = new NDKEvent(ndk, {
          kind: 10000,
          content: existing?.content ?? '',
          tags: [...existingTags, ['p', event.pubkey]],
        })
        await updated.publish(devPublishRelaySet)
      }
      setMuted(true)
      setPanel(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="note-menu" ref={rootRef}>
      <button
        type="button"
        className="engage-btn engage-btn-more"
        onClick={() => setPanel(panel ? null : 'menu')}
        title="More"
      >
        <MoreIcon />
      </button>

      {copied && <span className="note-menu-toast">{copied} copied</span>}

      {panel === 'menu' && (
        <div className="note-menu-dropdown">
          <button type="button" onClick={() => copy('Event ID', event.id)}>
            Copy event ID
          </button>
          <button type="button" onClick={() => copy('User ID', event.author.npub)}>
            Copy user ID
          </button>
          <button
            type="button"
            onClick={() => copy('Share link', `https://njump.me/${event.encode()}`)}
          >
            Copy share link
          </button>
          <button type="button" onClick={() => copy('Note content', event.content)}>
            Copy note content
          </button>
          <button type="button" onClick={() => setPanel('raw')}>
            View raw event
          </button>
          <button type="button" onClick={() => setPanel('report')} disabled={reported}>
            {reported ? 'Reported' : 'Report'}
          </button>
          <button type="button" onClick={handleMute} disabled={muted || busy}>
            {muted ? 'Muted' : 'Mute user'}
          </button>
        </div>
      )}

      {panel === 'raw' && (
        <div className="note-menu-panel">
          <textarea
            className="textarea raw-event"
            readOnly
            value={JSON.stringify(event.rawEvent(), null, 2)}
            rows={10}
          />
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPanel(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {panel === 'report' && (
        <div className="note-menu-panel">
          <span className="translate-panel-label">Report this note as…</span>
          <div className="language-grid">
            {REPORT_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleReport(type.value)}
                disabled={busy}
              >
                {type.label}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPanel(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
