import { ndk, localRelaySet } from './ndk'

// Paid long-form articles (NIP-23 + a NIP-90 DVM unlock job, kind
// 5904->6904 on server/cmd/dvm/main.go). Shared by ArticleComposer
// (encrypt at publish time) and the article unlock UI (decrypt after
// payment) — see the full design in
// /home/user/.claude/plans/crystalline-puzzling-gosling.md.

const DVM_HANDLER_D_TAG = 'nostras-dvm'
const KIND_HANDLER_ANNOUNCEMENT = 31990

export const KIND_ARTICLE_UNLOCK_REQUEST = 5904
export const KIND_ARTICLE_UNLOCK_RESULT = 6904

// Real, previously-unbounded hang caught live while verifying this, not
// hypothetical: ndk.fetchEvent() with no explicit timeout genuinely
// hung the composer's "Publishing…" state indefinitely (30+ seconds
// with zero error, confirmed before this fix) — the same bug class
// already found and fixed for the DM send path and SearchView earlier
// this session. Matches the withTimeout() pattern already established
// in remoteSigner.ts.
const DISCOVERY_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// Fetches the DVM's persisted article-encryption pubkey from its real,
// already-published kind:31990 NIP-89 handler announcement — a live
// source of truth this project already built (server's
// publishHandlerAnnouncement), rather than a second discovery channel
// or a build-time constant that could drift from server config.
// Deliberately NOT the announcement event's own signing pubkey — that
// key is only stable for one DVM process's lifetime (see the server
// entry's own comment on why); articleEncryptionPubkey is the separate,
// persisted key articles actually need to stay decryptable long-term.
// Scoped to localRelaySet since the DVM only ever publishes this to its
// own relay, not the public bootstrap pool.
export async function fetchDvmArticleEncryptionPubkey(): Promise<string | null> {
  const evt = await withTimeout(
    ndk.fetchEvent({ kinds: [KIND_HANDLER_ANNOUNCEMENT], '#d': [DVM_HANDLER_D_TAG] }, undefined, localRelaySet),
    DISCOVERY_TIMEOUT_MS,
    'Timed out looking up the DVM',
  )
  if (!evt) return null
  try {
    const content = JSON.parse(evt.content) as { articleEncryptionPubkey?: string }
    return content.articleEncryptionPubkey || null
  } catch {
    return null
  }
}

// NIP-44-encrypts an article body to the DVM's persisted key — a plain
// signer.encrypt() call, not the full NDKDVMRequest.encryption() dance
// (that's for job *requests*, which need their payload tags JSON-
// wrapped; this is just one blob of text). The DVM can decrypt it later
// using only its own static key + this event's own author pubkey (NIP-
// 44's Diffie-Hellman derivation), so no separate key needs to be
// generated or transmitted here.
export async function encryptArticleBody(plaintext: string, dvmPubkey: string): Promise<string> {
  if (!ndk.signer) throw new Error('Not signed in')
  const dvmUser = ndk.getUser({ pubkey: dvmPubkey })
  return ndk.signer.encrypt(dvmUser, plaintext, 'nip44')
}
