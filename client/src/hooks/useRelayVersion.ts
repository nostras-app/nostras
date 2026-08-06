import { useEffect, useState } from 'react'
import { ndk, localRelayUrl } from '../lib/ndk'

// Fetches the connected relay's own NIP-11 `version` field — the standard
// protocol mechanism for a relay to declare this, not something NOSTRAS
// invented. Shown alongside the client's own build SHA in Settings so
// "which version is running" is answerable for both sides from one place.
export function useRelayVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const relay = ndk.pool.getRelay(localRelayUrl, false, false)
    relay
      .fetchInfo()
      .then((info) => {
        if (!cancelled) setVersion(info.version ?? null)
      })
      .catch(() => {
        if (!cancelled) setVersion(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return version
}
