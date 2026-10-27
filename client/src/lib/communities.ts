import { requestDvmJob, type DvmJobUpdate } from './dvm'
import { localRelaySet } from './ndk'
import { fetchNewestDvmAnnouncement } from './dvmAnnouncement'

const KIND_JOB_REQUEST_COMMUNITY_JOIN = 5906
const KIND_JOB_RESULT_COMMUNITY_JOIN = 6906

// Fetches the DVM's persisted community-admin pubkey from its real,
// already-published kind:31990 NIP-89 handler announcement — same
// pattern as lib/paidArticles.ts's fetchDvmArticleEncryptionPubkey(),
// just a different field on the same announcement event. This is the
// pubkey a group owner needs to promote (via the existing promote-to-
// admin UI already in GroupAdminPanel) for paid joining to actually
// work — see server/cmd/dvm/main.go's own comment on why this key is
// separate from the DVM's per-boot signing identity and must stay
// stable across restarts.
export async function fetchDvmCommunityAdminPubkey(): Promise<string | null> {
  const evt = await fetchNewestDvmAnnouncement()
  if (!evt) return null
  try {
    const content = JSON.parse(evt.content) as { communityAdminPubkey?: string }
    return content.communityAdminPubkey || null
  } catch {
    return null
  }
}

// Paid Communities' client half — a thin wrapper around the generic
// requestDvmJob(), reused as-is per the approved plan: unlike paid
// articles, a group-join request needs no NIP-44 encryption (there's
// nothing private about "pubkey X wants to join public group Y"), so
// this needed no new protocol code, just the right kind numbers and
// relay scope. Scoped to localRelaySet, not devPublishRelaySet — see
// server/nip29.go's own header comment and CLAUDE.md's standing "all
// group reads/writes use localRelaySet, never devPublishRelaySet" rule:
// group data is meant to live only on NOSTRAS's own relay, and the DVM
// itself only ever listens on that same relay (NOSTRAS_RELAY_URL), so
// there's no reason for this request to also reach public relays.
export function requestGroupJoin(
  groupId: string,
  onUpdate: (update: DvmJobUpdate) => void,
): () => void {
  return requestDvmJob({
    requestKind: KIND_JOB_REQUEST_COMMUNITY_JOIN,
    resultKind: KIND_JOB_RESULT_COMMUNITY_JOIN,
    inputText: groupId,
    onUpdate,
    relaySet: localRelaySet,
  })
}
