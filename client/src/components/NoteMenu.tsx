import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKEvent as NDKEventType } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useActiveUser } from '../hooks/useActiveUser'
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

type Panel = 'menu' | 'raw' | 'report' | 'delete-confirm'

export function NoteMenu({ event }: { event: NDKEventType }) {
  const activeUser = useActiveUser()
  const isOwn = !!activeUser && event.pubkey === activeUser.pubkey
  const [panel, setPanel] = useState<Panel | null>(null)
  const [copied, setCopied] = useState('')
  const [reported, setReported] = useState(false)
  const [muted, setMuted] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [busy, setBusy] = useState(false)
  // Real gap reported by the user (2026-08-07): after publishing an
  // article local-only, then opting a public relay in as a session
  // publish target, there was no way to actually get that already-signed
  // event out to the new target — articles had no menu at all, and even
  // notes' menu had no "send this again to whatever relays I'm currently
  // publishing to" action. event.publish() on an already-signed NDKEvent
  // just re-sends the same bytes (same id/sig) to a relay set — no
  // re-signing, so this is a genuine rebroadcast, not a new version.
  const [rebroadcastState, setRebroadcastState] = useState<'idle' | 'busy' | 'done' | 'error'>(
    'idle',
  )
  const [rebroadcastError, setRebroadcastError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Every panel (menu/raw/report/delete-confirm) defaults to opening
  // upward via CSS (bottom: calc(100% + 6px)) -- fine for a note near the
  // bottom of a feed, but a real reported bug: for a trigger near the top
  // of the viewport (notifications are compact, so this happens often —
  // this is what surfaced it), opening upward clips the panel behind the
  // sticky header with no way to reach the cut-off items. Measured after
  // each render rather than assumed from viewport position alone, since
  // different panels (the raw-event textarea vs. the plain menu) have very
  // different heights.
  const [openBelow, setOpenBelow] = useState(false)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panel === 'menu' && rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPanel(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [panel])

  useLayoutEffect(() => {
    if (!panel || !panelRef.current) return
    // Rendered while still positioned upward (the CSS default) — a
    // negative top means it's already clipped above the viewport.
    // Deliberately not reset when the panel closes (panel === null): the
    // "Copied!" toast below renders right as a panel closes and reuses
    // this same direction, so it doesn't independently need re-measuring
    // for what's normally a very short-lived, small element.
    setOpenBelow(panelRef.current.getBoundingClientRect().top < 0)
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

  async function handleRebroadcast() {
    if (rebroadcastState === 'busy') return
    setRebroadcastState('busy')
    setRebroadcastError('')
    try {
      await event.publish(devPublishRelaySet)
      setRebroadcastState('done')
    } catch (e) {
      setRebroadcastError(e instanceof Error ? e.message : 'Rebroadcast failed')
      setRebroadcastState('error')
    }
  }

  async function handleDelete() {
    if (busy || deleted) return
    setBusy(true)
    try {
      // NIP-09: a deletion REQUEST, not a guarantee — relays may honor it
      // or not, and the event could already be mirrored elsewhere. The
      // `k` tag (the deleted event's own kind) is the newer recommended
      // addition to the spec, alongside the required `e` tag.
      const deletion = new NDKEvent(ndk, {
        kind: 5,
        content: '',
        tags: [
          ['e', event.id],
          ['k', String(event.kind)],
        ],
      })
      await deletion.publish(devPublishRelaySet)
      setDeleted(true)
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

      {copied && (
        <span className={`note-menu-toast${openBelow ? ' note-menu-below' : ''}`}>
          {copied} copied
        </span>
      )}

      {panel === 'menu' && (
        <div ref={panelRef} className={`note-menu-dropdown${openBelow ? ' note-menu-below' : ''}`}>
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
          <button
            type="button"
            onClick={handleRebroadcast}
            disabled={rebroadcastState === 'busy' || rebroadcastState === 'done'}
            title="Re-sends this exact already-signed event to whatever relays are currently active publish targets (Settings > Relays) — useful if a relay was toggled on after this was first published."
          >
            {rebroadcastState === 'busy'
              ? 'Rebroadcasting…'
              : rebroadcastState === 'done'
                ? 'Rebroadcast ✓'
                : 'Rebroadcast to current relays'}
          </button>
          {rebroadcastState === 'error' && (
            <span className="note-menu-inline-error">{rebroadcastError}</span>
          )}
          <button type="button" onClick={() => setPanel('report')} disabled={reported}>
            {reported ? 'Reported' : 'Report'}
          </button>
          <button type="button" onClick={handleMute} disabled={muted || busy}>
            {muted ? 'Muted' : 'Mute user'}
          </button>
          {isOwn && (
            <button
              type="button"
              className="note-menu-danger"
              onClick={() => setPanel('delete-confirm')}
              disabled={deleted}
            >
              {deleted ? 'Deleted' : 'Delete'}
            </button>
          )}
        </div>
      )}

      {(panel === 'raw' || panel === 'report' || panel === 'delete-confirm') && (
        <div className="note-menu-backdrop" onClick={() => setPanel(null)} />
      )}

      {panel === 'raw' && (
        <div ref={panelRef} className="note-menu-panel">
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
        <div ref={panelRef} className="note-menu-panel">
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

      {panel === 'delete-confirm' && (
        <div ref={panelRef} className="note-menu-panel">
          <span className="translate-panel-label">
            Delete this note? This publishes a deletion request (NIP-09) —
            most relays honor it, but it isn't a guarantee the note is gone
            everywhere.
          </span>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPanel(null)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={handleDelete}
              disabled={busy}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
