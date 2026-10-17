import { giftUnwrap } from '@nostr-dev-kit/ndk'
import { hasProcessedWrap, markWrapProcessed, getSinceFloor, hasProcessedRumor, markRumorProcessed } from './state.js'
import { log } from './logger.js'

// Ported from client/src/lib/dm.ts's decryptGiftWrap — same fail-closed
// shape (any malformed/undecryptable wrap -> null, never throws). Kept
// private to this module: nothing outside this file ever sees a raw
// decrypted rumor, only the pass/fail result of verifyAndExtractOwnerMessage
// below.
async function decryptGiftWrapUnsafe(wrap, signer) {
  try {
    const rumor = await giftUnwrap(wrap, undefined, signer)
    const recipientTag = rumor.tags.find((t) => t[0] === 'p')
    if (!rumor.pubkey || !recipientTag?.[1] || !rumor.content) return null
    return {
      senderPubkey: rumor.pubkey,
      content: rumor.content,
      rumorId: rumor.id,
      rumorCreatedAt: rumor.created_at ?? Math.floor(Date.now() / 1000),
    }
  } catch {
    return null
  }
}

// The ONLY function in this daemon's whole module graph that calls
// giftUnwrap or reads a decrypted rumor's sender pubkey. Returns:
//   - { ok: true, content, rumorId, rumorCreatedAt }  — genuinely from the owner
//   - { ok: false, rumorCreatedAt }                     — decrypted, but NOT the owner
//   - { ok: false, rumorCreatedAt: null }                — undecryptable/malformed
// Every caller only ever sees this shape — never the raw rumor — so a
// future edit reordering code would have to actively route around this
// one gate function to reach spawnClaude() with unverified content, not
// just forget an `if` somewhere.
export async function verifyAndExtractOwnerMessage(wrap, signer, ownerPubkeyHex) {
  const decrypted = await decryptGiftWrapUnsafe(wrap, signer)
  if (!decrypted) return { ok: false, rumorCreatedAt: null }
  if (decrypted.senderPubkey !== ownerPubkeyHex) {
    log.warn('Dropped DM from non-owner pubkey', { senderPubkey: decrypted.senderPubkey })
    return { ok: false, rumorCreatedAt: decrypted.rumorCreatedAt }
  }
  return {
    ok: true,
    content: decrypted.content,
    rumorId: decrypted.rumorId,
    rumorCreatedAt: decrypted.rumorCreatedAt,
  }
}

// Subscribes for gift wraps addressed to the agent and dispatches each
// genuinely-owner message to onOwnerMessage(content). `since` is purely a
// performance bound (see state.js's own comment) — actual replay safety
// is the persisted processedWraps set, checked before any decrypt is
// attempted (cheap, avoids a signer round-trip on a duplicate/already-seen
// wrap — same reasoning client/src/hooks/useDirectMessages.ts already
// uses for its own in-memory seenWrapIds set, just made durable here).
//
// Returns the live NDKSubscription — the caller (index.js) is
// responsible for calling .stop() and re-invoking this function whenever
// a listen relay recovers from a disconnect (see relayReconnect.js's own
// comment: NDK does not automatically resend an existing subscription's
// REQ to a relay that reconnects, which was found live to cause a real
// missed message, not a hypothetical edge case).
export function subscribeToInbox(ndk, agentPubkeyHex, ownerPubkeyHex, signer, onOwnerMessage) {
  const sub = ndk.subscribe(
    { kinds: [1059], '#p': [agentPubkeyHex], since: getSinceFloor() },
    { closeOnEose: false },
  )

  sub.on('event', async (wrap) => {
    if (hasProcessedWrap(wrap.id)) return

    const result = await verifyAndExtractOwnerMessage(wrap, signer, ownerPubkeyHex)

    if (!result.ok) {
      // Mark processed even on failure (wrong sender, or undecryptable)
      // so a restart doesn't keep re-attempting the same non-actionable
      // wrap forever. rumorCreatedAt is null for undecrypted wraps —
      // fall back to now for pruning purposes only, no functional effect.
      markWrapProcessed(wrap.id, result.rumorCreatedAt ?? Math.floor(Date.now() / 1000))
      return
    }

    // Persisted BEFORE dispatch, not after — a crash mid-Claude-invocation
    // must not cause this exact message to be replayed into a second,
    // duplicate turn on restart.
    markWrapProcessed(wrap.id, result.rumorCreatedAt)
    if (result.rumorId && hasProcessedRumor(result.rumorId)) {
      log.info('Skipped duplicate DM (same message, different wrap)', { rumorId: result.rumorId })
      return
    }
    if (result.rumorId) markRumorProcessed(result.rumorId, result.rumorCreatedAt)
    log.info('Accepted DM from owner', { rumorId: result.rumorId })

    try {
      await onOwnerMessage(result.content)
    } catch (e) {
      log.error('onOwnerMessage handler threw', { error: e instanceof Error ? e.message : String(e) })
    }
  })

  return sub
}
