import type { NDKEvent } from '@nostr-dev-kit/ndk'

// NIP-13: difficulty is the number of leading zero bits in the event
// id's hex representation. Mirrors server/pow.go's identical logic —
// two separate implementations (Go and TS) rather than one shared one,
// since there's no code-sharing mechanism between this client and the
// Go relay.
export function countLeadingZeroBits(hexId: string): number {
  let bits = 0
  for (const c of hexId) {
    const nibble = parseInt(c, 16)
    if (Number.isNaN(nibble)) return bits
    if (nibble === 0) {
      bits += 4
      continue
    }
    for (let shift = 3; shift >= 0; shift--) {
      if (nibble & (1 << shift)) break
      bits++
    }
    break
  }
  return bits
}

export type MineResult = { id: string; tries: number }

const YIELD_EVERY = 300

// Mines a NIP-13 nonce for `event` in place. Mutates event.tags to add
// a ["nonce", counter, target] tag and repeatedly calls the event's own
// getEventHash() — NDK's real serialize()+sha256 code, the identical
// path .sign() uses internally — until the resulting id has at least
// `targetDifficulty` leading zero bits.
//
// event.pubkey and event.created_at MUST already be set by the caller
// before mining starts (mining brute-forces the nonce only, not those
// fields, since they're both fixed inputs to the hash) — sign() is
// expected to be called immediately after this resolves, without
// touching tags/content/pubkey/created_at again, so the id it computes
// matches exactly what was mined here.
//
// Chunked with periodic yields (every 300 attempts) so it never freezes
// the tab, and cancelable via `shouldCancel`.
export async function mineEvent(
  event: NDKEvent,
  targetDifficulty: number,
  onProgress: (tries: number) => void,
  shouldCancel: () => boolean,
): Promise<MineResult> {
  event.tags = event.tags.filter((t) => t[0] !== 'nonce')
  const nonceTag: string[] = ['nonce', '0', String(targetDifficulty)]
  event.tags.push(nonceTag)

  let tries = 0
  for (;;) {
    tries++
    nonceTag[1] = String(tries)
    const id = event.getEventHash()
    if (countLeadingZeroBits(id) >= targetDifficulty) {
      return { id, tries }
    }
    if (tries % YIELD_EVERY === 0) {
      if (shouldCancel()) throw new Error('Mining cancelled')
      onProgress(tries)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}
