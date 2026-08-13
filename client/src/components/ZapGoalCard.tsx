import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useZapList } from '../hooks/useZapTotal'
import { parseZapGoalMeta } from '../lib/zapGoal'
import { formatRelativeTime } from '../lib/time'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { ZapButton } from './ZapButton'
import { NoteMenu } from './NoteMenu'

// NIP-75 zap goal card — reuses ZapButton completely unchanged for the
// actual contribute flow (it's already generic over any NDKEvent, not
// note-specific) and useZapList (already sums every real kind:9735
// receipt tagging an event id) for progress, rather than building new
// zap/invoice/total machinery for what's structurally the same "zap
// this event" action already proven elsewhere in this app.
export function ZapGoalCard({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const meta = parseZapGoalMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const { total: raisedSats } = useZapList(event.id)
  const percent = meta.amountSats > 0 ? Math.min(100, Math.round((raisedSats / meta.amountSats) * 100)) : 0

  return (
    <li className="feed-item zap-goal-card">
      <div className="feed-item-meta">
        <button type="button" className="feed-item-name-btn" onClick={() => viewProfile(event.pubkey)}>
          <span className="feed-item-name">{authorLabel}</span>
        </button>
        {event.created_at && <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>}
        <NoteMenu event={event} />
      </div>

      {isSecureImageUrl(meta.image) && <img className="zap-goal-image" src={meta.image} alt="" />}

      <p className="zap-goal-description">{meta.description}</p>

      <div className="zap-goal-progress-track">
        <div className="zap-goal-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="zap-goal-progress-label">
        <strong>{raisedSats.toLocaleString()}</strong> / {meta.amountSats.toLocaleString()} sats
        {' '}({percent}%)
      </p>

      <ZapButton event={event} />
    </li>
  )
}
