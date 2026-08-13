import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NDKEvent, NDKRelaySet, normalizeRelayUrl } from '@nostr-dev-kit/ndk'
import type { NDKEvent as NDKEventType, NDKRelay } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, localRelayUrl, authorQueryRelaySet } from '../lib/ndk'
import { makeRelayConnectionFilter } from '../lib/relayFilter'
import { CURATED_RELAYS } from '../lib/curatedRelays'
import { useActiveUser } from '../hooks/useActiveUser'
import { requestDvmJob, type DvmJobUpdate } from '../lib/dvm'
import { findExistingModerationLabel } from '../lib/moderationLabel'
import { getSavedNwcUri, payInvoiceWithNwc } from '../lib/nwc'
import { MoreIcon } from './icons'

const isAllowedRelay = makeRelayConnectionFilter(localRelayUrl)

const KIND_JOB_REQUEST_MODERATE = 5501
const KIND_JOB_RESULT_MODERATE = 6501

type CheckState = 'idle' | 'requesting' | 'payment-required' | 'done' | 'error'

// The DVM's moderateSystemPrompt (server/cmd/dvm/main.go) asks for a
// lightweight, prompted convention rather than a real structured-output
// API feature: line 1 a strict JSON verdict, line 2+ a human-readable
// reason. Tries to parse line 1 for a real badge; a malformed or missing
// line 1 falls back to showing the raw content as plain text instead of
// hard-failing, matching the same graceful-degrade posture the DVM's own
// design already commits to.
function parseCheckResult(content: string): { verdict?: string; confidence?: string; reason: string } {
  const newlineIndex = content.indexOf('\n')
  const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex)
  const rest = newlineIndex === -1 ? '' : content.slice(newlineIndex + 1).trim()
  try {
    const parsed = JSON.parse(firstLine) as { verdict?: string; confidence?: string }
    if (typeof parsed.verdict === 'string') {
      return { verdict: parsed.verdict, confidence: parsed.confidence, reason: rest || content }
    }
  } catch {
    // Falls through to the plain-text fallback below.
  }
  return { reason: content }
}

const REPORT_TYPES: { value: string; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'nudity', label: 'Nudity' },
  { value: 'profanity', label: 'Profanity' },
  { value: 'illegal', label: 'Illegal' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'malware', label: 'Malware' },
  { value: 'other', label: 'Other' },
]

type Panel = 'menu' | 'raw' | 'report' | 'delete-confirm' | 'rebroadcast' | 'check'

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
  // notes' menu had no "send this again" action. event.publish() on an
  // already-signed NDKEvent just re-sends the same bytes (same id/sig) to
  // a relay set — no re-signing, so this is a genuine rebroadcast, not a
  // new version. Follow-up the same day: the user compared this to
  // Yakihonne's own "republish", which offers a 30+-relay checklist
  // rather than one implicit target — so this grew from a single-click
  // action into a curated relay picker (CURATED_RELAYS), a deliberately
  // separate mechanism from devPublishRelaySet/Settings > Relays, since
  // this is a one-off "get this specific note more reach" action, not the
  // app's standing local-only-by-default publish scope.
  const [rebroadcastState, setRebroadcastState] = useState<'idle' | 'busy' | 'done' | 'error'>(
    'idle',
  )
  const [rebroadcastError, setRebroadcastError] = useState('')
  const [rebroadcastCount, setRebroadcastCount] = useState(0)
  const [selectedRelays, setSelectedRelays] = useState<Set<string>>(() => new Set(CURATED_RELAYS))
  // User follow-up (2026-08-07): "I understand 15 selected 7 successful" —
  // wanted to see *which* relays actually took it, not just the count.
  // NDKEvent is a real EventEmitter during a publish: NDK's own
  // NDKRelayPublisher emits "relay:published" / "relay:publish:failed" on
  // the event itself as each individual relay resolves, independent of
  // the aggregate NDKRelaySet.publish() promise — so this listens on the
  // event directly rather than waiting for the batch to finish. Keyed by
  // normalizeRelayUrl since that's the form NDKRelay.url is always in
  // (adds a trailing slash), not the raw curated URL string.
  const [relayResults, setRelayResults] = useState<Record<string, 'pending' | 'success' | 'failed'>>(
    {},
  )
  // "Check this note" — the client-side consumer piece of the DVM's 4th
  // job kind (server/cmd/dvm/main.go, kind 5501->6501, scoped and shipped
  // 2026-08-09). Structurally simpler than TranslateButton: no picker
  // step, since there's no parameter to choose — clicking the menu item
  // fires the job directly. Only re-fires on an explicit "Check again"
  // inside the done/error view, not on every reopen of the menu item,
  // matching this component's existing idempotent-guard convention
  // (report/mute/delete) so reopening the panel can't accidentally
  // trigger a second paid job.
  const [checkState, setCheckState] = useState<CheckState>('idle')
  const [checkResult, setCheckResult] = useState('')
  const [checkErrorMsg, setCheckErrorMsg] = useState('')
  const [checkInvoice, setCheckInvoice] = useState('')
  const [checkAmountSats, setCheckAmountSats] = useState(0)
  const [checkPaying, setCheckPaying] = useState(false)
  const checkCancelRef = useRef<(() => void) | null>(null)
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

  // Stops the underlying DVM-job subscription if this note scrolls out
  // and unmounts mid-request — requestDvmJob's cancel function tears down
  // its NDK subscription, same cleanup TranslateButton already does.
  useEffect(() => () => checkCancelRef.current?.(), [])

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
      // Scoped to authorQueryRelaySet — same unscoped-authors-filter bug
      // class already found and fixed in useFollowing/useFollowCounts/
      // useNoteFeed/useProfile/BookmarksView (see authorQueryRelaySet's
      // own comment in lib/ndk.ts). Without this, a race against NDK's
      // CONNECTED-only relay fallback could resolve to a stale/empty
      // mute list, and since kind:10000 is replaceable, publishing from
      // that empty list would silently wipe the user's real mute list.
      const existing = await ndk.fetchEvent(
        { kinds: [10000], authors: [ndk.activeUser?.pubkey ?? ''] },
        undefined,
        authorQueryRelaySet,
      )
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

  function toggleRelay(url: string) {
    setSelectedRelays((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  async function handleRebroadcast() {
    if (rebroadcastState === 'busy' || selectedRelays.size === 0) return
    setRebroadcastState('busy')
    setRebroadcastError('')
    // Curated URLs are a hardcoded, trusted constant, but filtering here
    // anyway matches this codebase's standing rule (learned the hard way
    // from the DM recipient-relay-discovery work): always pre-filter
    // before NDKRelaySet.fromRelayUrls, since it constructs and returns
    // NDKRelay objects unconditionally, bypassing the pool-level
    // relayConnectionFilter entirely.
    const urls = Array.from(selectedRelays).filter(isAllowedRelay)
    const normalizedUrls = urls.map(normalizeRelayUrl)
    setRelayResults(Object.fromEntries(normalizedUrls.map((u) => [u, 'pending' as const])))

    const onPublished = (relay: NDKRelay) => {
      setRelayResults((prev) => ({ ...prev, [relay.url]: 'success' }))
    }
    const onFailed = (relay: NDKRelay) => {
      setRelayResults((prev) => ({ ...prev, [relay.url]: 'failed' }))
    }
    event.on('relay:published', onPublished)
    event.on('relay:publish:failed', onFailed)

    try {
      const relaySet = NDKRelaySet.fromRelayUrls(urls, ndk)
      // Real user-reported gap (2026-08-11): this opens up to 15 relay
      // connections concurrently from one browser tab, all racing a
      // shared deadline — under real contention (a real device, a real
      // network), several genuinely don't finish in time even though
      // each one individually connects in well under a second when
      // tested alone (confirmed live: nos.lol read+write both completed
      // in ~0.4s in isolation, yet consistently showed "failed" here
      // across repeated attempts). The composer/EngagementBar's 8s
      // timeout is right for a single relay on the hot path; this is a
      // deliberate, one-off, up-to-15-way concurrent action, so it gets
      // a longer allowance instead of inheriting the same number.
      const published = await event.publish(relaySet, 20000)
      setRebroadcastCount(published.size)
      // A relay that neither published nor explicitly failed (e.g. never
      // connected in time) stays "pending" forever otherwise — resolve
      // any leftovers to "failed" once the batch itself is done.
      setRelayResults((prev) => {
        const next = { ...prev }
        for (const u of normalizedUrls) if (next[u] === 'pending') next[u] = 'failed'
        return next
      })
      setRebroadcastState('done')
    } catch (e) {
      setRebroadcastError(e instanceof Error ? e.message : 'Rebroadcast failed')
      setRelayResults((prev) => {
        const next = { ...prev }
        for (const u of normalizedUrls) if (next[u] === 'pending') next[u] = 'failed'
        return next
      })
      setRebroadcastState('error')
    } finally {
      event.off('relay:published', onPublished)
      event.off('relay:publish:failed', onFailed)
    }
  }

  function runCheck() {
    setCheckState('requesting')
    setCheckErrorMsg('')
    checkCancelRef.current = requestDvmJob({
      requestKind: KIND_JOB_REQUEST_MODERATE,
      resultKind: KIND_JOB_RESULT_MODERATE,
      inputText: event.content,
      // NIP-32: lets the DVM publish a real kind:1985 label pointing at
      // this actual event (server/cmd/dvm/main.go's
      // publishModerationLabel) — the job itself only ever sees raw
      // text, never the event id, so without this the classification
      // stays a private response only this click ever sees.
      params: [['event_id', event.id]],
      onUpdate: (update: DvmJobUpdate) => {
        if (update.status === 'processing') {
          setCheckState('requesting')
        } else if (update.status === 'payment-required') {
          setCheckInvoice(update.invoice)
          setCheckAmountSats(Math.round(update.amountMsat / 1000))
          setCheckState('payment-required')
        } else if (update.status === 'done') {
          setCheckResult(update.result)
          setCheckState('done')
        } else if (update.status === 'error') {
          setCheckErrorMsg(update.message)
          setCheckState('error')
        }
      },
    })
  }

  async function handleCheck() {
    setPanel('check')
    // Only auto-fire on first open — reopening an already-run check just
    // shows the existing result instead of silently starting a second
    // paid job. "Check again" inside the done/error view is the only
    // explicit re-trigger.
    if (checkState !== 'idle') return

    // NIP-32: a real label may already exist from an earlier check —
    // by this session, another user, or a previous reload — since the
    // DVM now publishes one alongside every classification result. Show
    // it directly, for free, instead of always re-running a paid job.
    setCheckState('requesting')
    const existing = await findExistingModerationLabel(event.id)
    if (existing) {
      setCheckResult(`{"verdict":${JSON.stringify(existing.verdict)}}\n${existing.reason}`)
      setCheckState('done')
      return
    }
    runCheck()
  }

  async function handleCheckPayWithWallet() {
    const nwcUri = getSavedNwcUri()
    if (!nwcUri) return
    setCheckPaying(true)
    try {
      await payInvoiceWithNwc(nwcUri, checkInvoice)
      // The DVM publishes "processing" once it observes settlement, then
      // the result — the onUpdate handler in runCheck moves us out of
      // this state from there.
      setCheckState('requesting')
    } catch (e) {
      setCheckErrorMsg(e instanceof Error ? e.message : 'Payment failed')
      setCheckState('error')
    } finally {
      setCheckPaying(false)
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
            onClick={() => setPanel('rebroadcast')}
            disabled={rebroadcastState === 'busy'}
            title="Re-sends this exact already-signed event to whichever public relays you pick — separate from Settings > Relays' session publish targets, meant for getting one specific note or article more reach."
          >
            {rebroadcastState === 'done'
              ? `Rebroadcast ✓ (${rebroadcastCount})`
              : 'Rebroadcast to relays…'}
          </button>
          <button
            type="button"
            onClick={handleCheck}
            title="Runs a real NIP-90 DVM job (kind 5501) asking Claude to classify this note as spam, scam, or legit — you only pay if the job completes."
          >
            {checkState === 'done' ? 'Checked ✓' : 'Check for spam/scam…'}
          </button>
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

      {(panel === 'raw' ||
        panel === 'report' ||
        panel === 'delete-confirm' ||
        panel === 'rebroadcast' ||
        panel === 'check') && <div className="note-menu-backdrop" onClick={() => setPanel(null)} />}

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

      {panel === 'rebroadcast' && (
        <div ref={panelRef} className="note-menu-panel">
          <span className="translate-panel-label">Rebroadcast to…</span>
          <p className="field-hint">
            Re-sends this exact already-signed event (same id, no
            re-signing) to whichever relays you pick — independent of
            your session's publish-target toggles in Settings.
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedRelays(new Set(CURATED_RELAYS))}
              disabled={rebroadcastState === 'busy'}
            >
              Select all
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedRelays(new Set())}
              disabled={rebroadcastState === 'busy'}
            >
              Select none
            </button>
          </div>
          <div className="rebroadcast-relay-list">
            {CURATED_RELAYS.map((url) => {
              const result = relayResults[normalizeRelayUrl(url)]
              return (
                <label key={url} className="rebroadcast-relay-row">
                  <input
                    type="checkbox"
                    checked={selectedRelays.has(url)}
                    onChange={() => toggleRelay(url)}
                    disabled={rebroadcastState === 'busy'}
                  />
                  <span className="relay-url">{url.replace('wss://', '')}</span>
                  {selectedRelays.has(url) && result && (
                    <span
                      className={`relay-result relay-result-${result}`}
                      title={
                        result === 'pending'
                          ? 'Waiting…'
                          : result === 'success'
                            ? 'Received it'
                            : 'Rejected, timed out, or unreachable'
                      }
                    >
                      {result === 'pending' ? '…' : result === 'success' ? '✓' : '✕'}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
          {rebroadcastState === 'error' && (
            <span className="note-menu-inline-error">{rebroadcastError}</span>
          )}
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPanel(null)}
              disabled={rebroadcastState === 'busy'}
            >
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleRebroadcast}
              disabled={rebroadcastState === 'busy' || selectedRelays.size === 0}
            >
              {rebroadcastState === 'busy'
                ? 'Rebroadcasting…'
                : rebroadcastState === 'done'
                  ? `Rebroadcast ✓ (${rebroadcastCount})`
                  : `Rebroadcast to ${selectedRelays.size} relay${selectedRelays.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {panel === 'check' && (
        <div ref={panelRef} className="note-menu-panel">
          <span className="translate-panel-label">Content check</span>

          {(checkState === 'idle' || checkState === 'requesting') && (
            <p className="field-hint">Checking…</p>
          )}

          {checkState === 'payment-required' && (
            <div className="stack">
              <p className="field-hint">
                Payment required to run this job — you are paying{' '}
                <strong>{checkAmountSats} sats</strong>.
              </p>
              <textarea className="textarea" readOnly value={checkInvoice} rows={3} />
              <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigator.clipboard.writeText(checkInvoice)}
                >
                  Copy invoice
                </button>
                {getSavedNwcUri() && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleCheckPayWithWallet}
                    disabled={checkPaying}
                  >
                    {checkPaying ? 'Paying…' : 'Pay with connected wallet'}
                  </button>
                )}
              </div>
            </div>
          )}

          {checkState === 'done' &&
            (() => {
              const { verdict, confidence, reason } = parseCheckResult(checkResult)
              return (
                <div className="stack">
                  {verdict && (
                    <span
                      className={`content-check-verdict content-check-verdict-${verdict}`}
                    >
                      {verdict}
                      {confidence ? ` · ${confidence} confidence` : ''}
                    </span>
                  )}
                  <p className="feed-item-content">{reason}</p>
                </div>
              )
            })()}

          {checkState === 'error' && <p className="alert-error">{checkErrorMsg}</p>}

          <div className="btn-row">
            {(checkState === 'done' || checkState === 'error') && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={runCheck}>
                Check again
              </button>
            )}
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
