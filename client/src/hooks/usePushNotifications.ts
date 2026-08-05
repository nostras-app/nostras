import { useCallback, useEffect, useState } from 'react'
import {
  getExistingPushSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/pushNotifications'

type Status = 'checking' | 'unsupported' | 'subscribed' | 'unsubscribed' | 'busy' | 'error'

export function usePushNotifications() {
  const [status, setStatus] = useState<Status>('checking')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus('unsupported')
      return
    }
    const existing = await getExistingPushSubscription()
    setStatus(existing ? 'subscribed' : 'unsubscribed')
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const subscribe = useCallback(async () => {
    setStatus('busy')
    setError(null)
    try {
      await subscribeToPush()
      setStatus('subscribed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to enable notifications')
      setStatus('unsubscribed')
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    setStatus('busy')
    setError(null)
    try {
      await unsubscribeFromPush()
      setStatus('unsubscribed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disable notifications')
      await refresh()
    }
  }, [refresh])

  return { status, error, subscribe, unsubscribe }
}
