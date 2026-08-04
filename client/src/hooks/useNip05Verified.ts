import { useEffect, useState } from 'react'
import type { NDKUser } from '@nostr-dev-kit/ndk'

// NDK's own NDKUser.validateNip05 does the real work: fetches
// https://<domain>/.well-known/nostr.json and checks the returned pubkey
// against this user's actual pubkey. true = verified, false = found but
// doesn't match (a real mismatch, not just "unset"), null = not found or
// couldn't verify (network issue, no NIP-05 set, etc).
export function useNip05Verified(
  user: NDKUser | undefined,
  nip05: string | undefined,
): boolean | null {
  const [verified, setVerified] = useState<boolean | null>(null)

  useEffect(() => {
    if (!user || !nip05) {
      setVerified(null)
      return
    }

    let cancelled = false
    setVerified(null)
    user
      .validateNip05(nip05)
      .then((result) => {
        if (!cancelled) setVerified(result)
      })
      .catch(() => {
        if (!cancelled) setVerified(null)
      })

    return () => {
      cancelled = true
    }
  }, [user, nip05])

  return verified
}
