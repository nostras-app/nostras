import { zapInvoiceFromEvent, type NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useNotifications } from '../hooks/useNotifications'
import { formatRelativeTime } from '../lib/time'
import { NoteContent } from './NoteContent'
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
      {profile?.picture ? (
        <img className="avatar" src={profile.picture} alt="" />
      ) : (
        <span className="avatar-fallback">{label.charAt(0)}</span>
      )}
      <div className="feed-item-body">
        <div className="feed-item-meta">
          <span className={`notification-icon ${colorClass}`}>{icon}</span>
          <span className="feed-item-name">{label}</span>
          <span className="notification-action">{action}</span>
          {event.created_at && (
            <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>
          )}
        </div>
        {event.kind === 1 && <NoteContent content={event.content} />}
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
