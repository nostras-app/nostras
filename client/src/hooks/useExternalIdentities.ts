import { useEffect, useState } from 'react'
import type { NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, authorQueryRelaySet } from '../lib/ndk'
import { parseExternalIdentityTag, type ExternalIdentity } from '../lib/externalIdentities'

// Same NDKKind-enum gap already hit for NIP-29's delete kinds, the
// paid-article-unlock result kind, and NIP-38 statuses — 10011 isn't in
// NDK's own catalog either.
export const KIND_EXTERNAL_IDENTITIES = 10011 as NDKKind

// Read-only: any pubkey's claimed NIP-39 identities, for display on a
// profile (own or someone else's). Scoped to authorQueryRelaySet, not
// left unscoped — this is an authors-filtered fetchEvent, the exact NDK
// query shape that's raced NDK's CONNECTED-only relay fallback several
// times elsewhere in this project (see lib/ndk.ts's own comment on
// authorQueryRelaySet).
export function useExternalIdentities(pubkey: string | undefined): ExternalIdentity[] {
  const [identities, setIdentities] = useState<ExternalIdentity[]>([])

  useEffect(() => {
    setIdentities([])
    if (!pubkey) return
    let cancelled = false
    ndk
      .fetchEvent(
        { kinds: [KIND_EXTERNAL_IDENTITIES], authors: [pubkey] },
        undefined,
        authorQueryRelaySet,
      )
      .then((event) => {
        if (cancelled || !event) return
        setIdentities(event.tags.map(parseExternalIdentityTag).filter((x): x is ExternalIdentity => x !== null))
      })
      .catch(() => {
        // Degrade to "no linked accounts shown" — same posture as every
        // other optional profile signal in this app.
      })
    return () => {
      cancelled = true
    }
  }, [pubkey])

  return identities
}
