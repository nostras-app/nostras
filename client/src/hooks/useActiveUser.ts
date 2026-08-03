import { useSyncExternalStore } from 'react'
import type { NDKUser } from '@nostr-dev-kit/ndk'
import { ndk } from '../lib/ndk'

function subscribe(listener: () => void) {
  ndk.on('activeUser:change', listener)
  return () => {
    ndk.off('activeUser:change', listener)
  }
}

// ndk.activeUser changes whenever ndk.signer is swapped (e.g. connecting or
// disconnecting a NIP-46 remote signer) — components must resubscribe to
// this rather than reading ndk.activeUser once at render time.
export function useActiveUser(): NDKUser | undefined {
  return useSyncExternalStore(subscribe, () => ndk.activeUser)
}
