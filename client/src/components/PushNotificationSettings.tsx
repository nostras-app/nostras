import { usePushNotifications } from '../hooks/usePushNotifications'

export function PushNotificationSettings() {
  const { status, error, subscribe, unsubscribe } = usePushNotifications()

  if (status === 'unsupported') {
    return (
      <p className="field-hint">
        Push notifications aren't available in this browser/environment (needs a
        service worker and the Push API, and the server's VAPID key configured).
      </p>
    )
  }

  if (status === 'checking') {
    return <p className="field-hint">Checking notification status…</p>
  }

  return (
    <div className="field-row" style={{ alignItems: 'center' }}>
      <p className="field-hint" style={{ flex: 1 }}>
        {status === 'subscribed'
          ? 'Notified on this device for mentions, replies, reposts, likes, zaps, and DMs.'
          : 'Get notified on this device for mentions, replies, reposts, likes, zaps, and DMs — even when NOSTRAS isn\'t open.'}
      </p>
      {status === 'subscribed' ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={unsubscribe}>
          Disable
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={subscribe}
          disabled={status === 'busy'}
        >
          {status === 'busy' ? 'Enabling…' : 'Enable'}
        </button>
      )}
      {error && <p className="alert-error">{error}</p>}
    </div>
  )
}
