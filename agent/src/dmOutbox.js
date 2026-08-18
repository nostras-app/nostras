import { NDKEvent, NDKRelaySet, giftWrap } from '@nostr-dev-kit/ndk'
import { fetchLatestReplaceableEvent } from './fetchLatestReplaceable.js'
import { isAllowedRelayUrl, LISTEN_RELAY_URLS } from './ndkClient.js'
import { log } from './logger.js'

const DM_RELAY_LIST_KIND = 10050
const RELAY_LIST_KIND = 10002
const DISCOVERY_TIMEOUT_MS = 8000
const PUBLISH_TIMEOUT_MS = 8000

// Ported from client/src/lib/dm.ts's discoverRecipientDmRelays — same
// kind:10050-preferred, kind:10002-fallback lookup, using
// fetchLatestReplaceableEvent (not plain ndk.fetchEvent()) for the same
// stale-copy-race reason documented there. Untrusted third-party relay
// URLs are filtered through relayFilter.js before ever being handed to
// NDKRelaySet.fromRelayUrls() — that call bypasses NDK's own pool-level
// relayConnectionFilter entirely, so this manual filter is the only real
// guard here (already proven necessary once in the client).
export async function discoverRecipientDmRelays(ndk, pubkeyHex) {
  const lookupRelaySet = NDKRelaySet.fromRelayUrls(LISTEN_RELAY_URLS, ndk)
  try {
    const dmList = await fetchLatestReplaceableEvent(
      ndk,
      { kinds: [DM_RELAY_LIST_KIND], authors: [pubkeyHex] },
      lookupRelaySet,
      DISCOVERY_TIMEOUT_MS,
    )
    const dmRelays = (dmList?.tags ?? [])
      .filter((t) => t[0] === 'r' && !!t[1])
      .map((t) => t[1])
    if (dmRelays.length > 0) return dmRelays.filter(isAllowedRelayUrl)

    const relayList = await fetchLatestReplaceableEvent(
      ndk,
      { kinds: [RELAY_LIST_KIND], authors: [pubkeyHex] },
      lookupRelaySet,
      DISCOVERY_TIMEOUT_MS,
    )
    const writeRelays = (relayList?.tags ?? [])
      .filter((t) => t[0] === 'r' && !!t[1] && t[2] !== 'read')
      .map((t) => t[1])
    return writeRelays.filter(isAllowedRelayUrl)
  } catch {
    return []
  }
}

// Mirrors sendDirectMessage in client/src/lib/dm.ts: a self-addressed
// copy too (so the agent's own conversation view — if ever built — would
// show its own sent messages), published to the daemon's fixed relay set
// plus whatever was discovered for the owner specifically.
export async function sendReply(ndk, agentPubkeyHex, ownerPubkeyHex, content) {
  const ownerUser = ndk.getUser({ pubkey: ownerPubkeyHex })
  const agentUser = ndk.getUser({ pubkey: agentPubkeyHex })

  const rumor = new NDKEvent(ndk, {
    kind: 14,
    content,
    tags: [['p', ownerPubkeyHex]],
    created_at: Math.floor(Date.now() / 1000),
  })

  const [wrapForOwner, wrapForSelf, ownerRelayUrls] = await Promise.all([
    giftWrap(rumor, ownerUser),
    giftWrap(rumor, agentUser),
    discoverRecipientDmRelays(ndk, ownerPubkeyHex),
  ])

  const baseRelaySet = NDKRelaySet.fromRelayUrls(LISTEN_RELAY_URLS, ndk)
  const publishes = [
    wrapForOwner.publish(baseRelaySet, PUBLISH_TIMEOUT_MS),
    wrapForSelf.publish(baseRelaySet, PUBLISH_TIMEOUT_MS),
  ]
  if (ownerRelayUrls.length > 0) {
    const ownerRelaySet = NDKRelaySet.fromRelayUrls(ownerRelayUrls, ndk)
    publishes.push(wrapForOwner.publish(ownerRelaySet, PUBLISH_TIMEOUT_MS))
  }

  await Promise.all(publishes)
  log.info('Sent reply DM', { chars: content.length })
}
