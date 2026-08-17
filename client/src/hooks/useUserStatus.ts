import { useEffect, useState } from 'react'
import type { NDKKind } from '@nostr-dev-kit/ndk'
import { authorQueryRelaySet } from '../lib/ndk'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'

export type UserStatus = { content: string; url: string | null }

// Same NDKKind-enum gap already hit for the NIP-29 delete kinds and the
// paid-article-unlock result kind — NDK's own catalog doesn't know this
// number either.
const KIND_USER_STATUS = 30315 as NDKKind

// NIP-38 "general" status (kind:30315, d=general) — a real, previously-
// flagged gap: nothing let a user set or see a short "what I'm up to"
// line. Scoped to authorQueryRelaySet, not left unscoped — this is an
// authors-filtered fetchEvent, the exact NDK query shape that's raced
// NDK's CONNECTED-only relay fallback multiple times elsewhere in this
// app (see lib/ndk.ts's own comment on authorQueryRelaySet) — applying
// that fix proactively here instead of rediscovering the bug again.
export function useUserStatus(pubkey: string | undefined): UserStatus | null {
  const [status, setStatus] = useState<UserStatus | null>(null)

  useEffect(() => {
    setStatus(null)
    if (!pubkey) return
    let cancelled = false
    // fetchLatestReplaceableEvent, not plain ndk.fetchEvent() — even
    // authorQueryRelaySet-scoped, fetchEvent() hardcodes closeOnEose:true
    // and can converge on a stale relay's copy of this addressable
    // kind:30315 status before a slower relay's fresher one arrives
    // (2026-08-17, see CLAUDE.md's dated entry).
    fetchLatestReplaceableEvent(
      { kinds: [KIND_USER_STATUS], authors: [pubkey], '#d': ['general'] },
      authorQueryRelaySet,
    )
      .then((event) => {
        if (cancelled || !event) return
        // NIP-38: "An empty string instructs clients to clear the status."
        if (!event.content) return
        const expirationTag = event.tags.find((t) => t[0] === 'expiration')
        if (expirationTag) {
          const expiresAt = Number(expirationTag[1])
          if (!Number.isNaN(expiresAt) && expiresAt * 1000 < Date.now()) return
        }
        const urlTag = event.tags.find((t) => t[0] === 'r')
        setStatus({ content: event.content, url: urlTag?.[1] ?? null })
      })
      .catch(() => {
        // Degrade to "no status shown" — same posture as every other
        // optional profile signal in this app (NIP-05, wallet balance).
      })
    return () => {
      cancelled = true
    }
  }, [pubkey])

  return status
}
