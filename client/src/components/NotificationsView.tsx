import { zapInvoiceFromEvent, type NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useNotifications } from '../hooks/useNotifications'
import { formatRelativeTime } from '../lib/time'
import { viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { getContentWarningReason } from '../lib/contentWarning'
import { getSubject } from '../lib/subject'
import { NoteContent } from './NoteContent'
import { NoteMenu } from './NoteMenu'
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
        {/* Real traceability gap reported by the user (2026-08-07): a
            notification's actor name wasn't even clickable, and there was
            no way to inspect who they actually are beyond the display
            name NDK happened to cache — no profile link, no way to see
            the account's real npub or the notification event's raw data.
            Both fixed above/below by reusing the exact same
            viewProfile()/NoteMenu already proven for regular notes,
            rather than building new investigation tooling from scratch. */}
        <div className="feed-item-footer notification-item-footer">
          <NoteMenu event={event} />
        </div>
      </div>
    </li>
  )
}

export function NotificationsView() {
  const { events, loading } = useNotifications()

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
