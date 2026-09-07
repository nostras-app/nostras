import { zapInvoiceFromEvent, type NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useReferencedNote } from '../hooks/useReferencedNote'
import { formatRelativeTime } from '../lib/time'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { getContentWarningReason } from '../lib/contentWarning'
import { getSubject } from '../lib/subject'
import { getReactedEventId } from '../lib/nip10'
import { NoteContent } from './NoteContent'
import { NoteMenu } from './NoteMenu'
import { EngagementBar } from './EngagementBar'
import { FeedSkeleton } from './Feed'
import { ReplyIcon, RepostIcon, HeartIcon, ZapIcon } from './icons'

function describeNotification(event: NDKEvent) {
  switch (event.kind) {
    case 6:
      return {
        actor: event.pubkey,
        icon: <RepostIcon />,
        action: 'reposted your note',
        colorClass: 'notification-icon-repost',
      }
    case 7:
      return {
        actor: event.pubkey,
        icon: <HeartIcon filled />,
        action: 'liked your note',
        colorClass: 'notification-icon-like',
      }
    case 9735: {
      const invoice = zapInvoiceFromEvent(event)
      const sats = invoice ? Math.round(invoice.amount / 1000) : null
      return {
        actor: invoice?.zappee ?? event.pubkey,
        icon: <ZapIcon filled />,
        action: sats ? `zapped you ${sats} sats` : 'zapped you',
        colorClass: 'notification-icon-zap',
      }
    }
    default:
      return {
        actor: event.pubkey,
        icon: <ReplyIcon />,
        action: 'mentioned you',
        colorClass: '',
      }
  }
}

function NotificationItem({ event }: { event: NDKEvent }) {
  const { actor, icon, action, colorClass } = describeNotification(event)
  const profile = useProfile(actor)
  const label = profile?.name || profile?.displayName || `${actor.slice(0, 12)}…`

  // Real gap found comparing against Ditto's own notifications (2026-09-07):
  // NOSTRAS never offered reply/repost/like/zap straight from a
  // notification, only a "..." menu. For a mention/reply (kind:1), `event`
  // IS the note to act on directly. For a repost/like/zap (kind:6/7/9735),
  // `event` is the reaction/receipt itself — there's nothing meaningful to
  // reply/repost/like/zap on a bare reaction, so fetch the actual note it
  // references (its own single, unmarked "e" tag — see getReactedEventId's
  // own comment for why this needs different tag logic than a NIP-10
  // reply's marked "e" tags) and act on that instead.
  const reactedEventId = event.kind !== 1 ? getReactedEventId(event.tags) : undefined
  const reactedNote = useReferencedNote(reactedEventId)
  const targetNote = event.kind === 1 ? event : reactedNote

  return (
    <li className="feed-item">
      <button
        type="button"
        className="feed-item-avatar-btn"
        onClick={() => viewProfile(actor)}
        title={`View ${label}'s profile`}
      >
        {isSecureImageUrl(profile?.picture) ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <span className="avatar-fallback">{label.charAt(0)}</span>
        )}
      </button>
      <div className="feed-item-body">
        <div className="feed-item-meta">
          <span className={`notification-icon ${colorClass}`}>{icon}</span>
          <button type="button" className="feed-item-name-btn" onClick={() => viewProfile(actor)}>
            <span className="feed-item-name">{label}</span>
          </button>
          <span className="notification-action">{action}</span>
          {event.created_at && (
            <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>
          )}
        </div>
        {event.kind === 1 && (
          <NoteContent
            content={event.content}
            contentWarning={getContentWarningReason(event.tags)}
            subject={getSubject(event.tags)}
            tags={event.tags}
          />
        )}
        {event.kind !== 1 && reactedNote && (
          <NoteContent
            content={reactedNote.content}
            contentWarning={getContentWarningReason(reactedNote.tags)}
            subject={getSubject(reactedNote.tags)}
            tags={reactedNote.tags}
          />
        )}
        {/* Real traceability gap reported by the user (2026-08-07): a
            notification's actor name wasn't even clickable, and there was
            no way to inspect who they actually are beyond the display
            name NDK happened to cache — no profile link, no way to see
            the account's real npub or the notification event's raw data.
            Fixed by reusing the exact same viewProfile() already proven
            for regular notes. The engagement/menu row below reuses
            EngagementBar (which includes its own NoteMenu) once the real
            target note is known, falling back to a bare NoteMenu on the
            notification event itself only while that's still resolving
            (or genuinely unfindable) — never a dead end either way. */}
        <div className="feed-item-footer notification-item-footer">
          {targetNote ? <EngagementBar event={targetNote} /> : <NoteMenu event={event} />}
        </div>
      </div>
    </li>
  )
}

// events/loading are lifted to App.tsx (which owns useNotifications()
// directly) rather than called here, so the nav rail's unread badge can
// read the exact same live list without opening a second, duplicate
// subscription to the same filter — the same "call the hook once, pass
// down as props" discipline this codebase already applies elsewhere
// (see MessagesView's own conversations/loading/decrypting props).
export function NotificationsView({
  events,
  loading,
}: {
  events: NDKEvent[]
  loading: boolean
}) {
  if (loading && events.length === 0) {
    return <FeedSkeleton />
  }

  if (events.length === 0) {
    return (
      <div className="feed-empty">
        <p>No notifications yet.</p>
        <p className="feed-empty-hint">
          Likes, reposts, replies, and zaps on your notes will show up here.
        </p>
      </div>
    )
  }

  return (
    <ul className="feed">
      {events.map((event) => (
        <NotificationItem key={event.id} event={event} />
      ))}
    </ul>
  )
}
