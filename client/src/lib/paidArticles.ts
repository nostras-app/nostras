import { NDKEvent, NDKKind, type NDKSubscription } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from './ndk'
import { fetchNewestDvmAnnouncement } from './dvmAnnouncement'

// Paid long-form articles (NIP-23 + a NIP-90 DVM unlock job, kind
// 5904->6904 on server/cmd/dvm/main.go). Shared by ArticleComposer
// (encrypt at publish time) and the article unlock UI (decrypt after
// payment) — see the full design in
// /home/user/.claude/plans/crystalline-puzzling-gosling.md.

const KIND_JOB_FEEDBACK = 7000

export const KIND_ARTICLE_UNLOCK_REQUEST = 5904
// NDK's NDKKind enum doesn't include this real, ratified-by-this-project
// job kind (same gap already hit for NIP-29's 9005/9008) — cast at the
// one place it's used as a subscription filter kind.
export const KIND_ARTICLE_UNLOCK_RESULT = 6904 as NDKKind

// Real, previously-unbounded hang caught live while verifying this, not
// hypothetical: ndk.fetchEvent() with no explicit timeout genuinely
// hung the composer's "Publishing…" state indefinitely (30+ seconds
// with zero error, confirmed before this fix) — the same bug class
// already found and fixed for the DM send path and SearchView earlier
// this session. Matches the withTimeout() pattern already established
// in remoteSigner.ts. Reused below for the unlock request's own publish
// call too, same reasoning.
const PAID_ARTICLE_TIMEOUT_MS = 8000

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
  const evt = await fetchNewestDvmAnnouncement()
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

export type ArticleUnlockUpdate =
  | { status: 'processing' }
  | { status: 'payment-required'; payee: 'author' | 'nostras'; amountMsat: number; invoice: string }
  | { status: 'done'; content: string }
  | { status: 'error'; message: string }

// A single unlock job now produces TWO sequential payment-required
// feedback events, not one: the DVM fetches the article author's own
// invoice server-side (a real HTTPS call to the domain in their
// published lud16 — see server/cmd/dvm/lnurl.go) and confirms
// settlement itself via LUD-21, before separately charging its own flat
// fee through the existing NWC-based flow every other job kind already
// uses. Distinguished here by the "payee" tag the server sets only on
// the author's own event ("author"; absent/anything else = NOSTRAS's
// own fee) — see server/cmd/dvm/main.go's publishPaymentRequiredFor.
// Neither leg needs anything special from this client (no invoice-
// fetching, no preimage capture) — an earlier version of this design
// did try to have the client fetch+prove the author's payment itself,
// but that was found to be cryptographically insecure and replaced;
// see the plan file's "real findings" section for the full story.
//
// Same request/feedback/result shape as lib/dvm.ts's requestDvmJob, but
// genuinely can't reuse it directly: the request payload needs NIP-90's
// own ["encrypted"] tag-JSON-wrapping convention (see server/cmd/dvm/
// main.go's handleArticleUnlockJob comment on why request encoding and
// result encoding are deliberately different shapes), and the result
// needs a NIP-44 decrypt before it's usable — requestDvmJob's `event.
// content` is always plaintext by design. Returns a cancel function,
// same contract as requestDvmJob.
export function requestArticleUnlock(opts: {
  articleEventId: string
  dvmPubkey: string
  onUpdate: (update: ArticleUnlockUpdate) => void
}): () => void {
  const { articleEventId, dvmPubkey, onUpdate } = opts
  let stopped = false
  let sub: NDKSubscription | null = null

  ;(async () => {
    try {
      if (!ndk.signer) throw new Error('Not signed in')
      const dvmUser = ndk.getUser({ pubkey: dvmPubkey })

      // Matches NDK's own NDKDVMRequest.encryption(): job-payload tags
      // (just `i` here) moved into content as a JSON array, then NIP-44-
      // encrypted to the DVM — exactly the wire format server/cmd/dvm/
      // main.go's handleArticleUnlockJob was built and verified against.
      const tagsJson = JSON.stringify([['i', articleEventId, 'event']])
      const encryptedContent = await ndk.signer.encrypt(dvmUser, tagsJson, 'nip44')

      const request = new NDKEvent(ndk, {
        kind: KIND_ARTICLE_UNLOCK_REQUEST,
        content: encryptedContent,
        tags: [
          ['p', dvmPubkey],
          ['encrypted'],
        ],
      })
      await request.sign()
      if (stopped) return

      sub = ndk.subscribe({
        kinds: [KIND_JOB_FEEDBACK, KIND_ARTICLE_UNLOCK_RESULT],
        '#e': [request.id],
      })
      sub.on('event', (event: NDKEvent) => {
        if (event.kind === KIND_ARTICLE_UNLOCK_RESULT) {
          // The result's own content is a direct NIP-44 ciphertext (not
          // the tag-JSON-wrapping the request used) — see the server-
          // side comment on why the two directions deliberately differ.
          ndk.signer
            ?.decrypt(dvmUser, event.content, 'nip44')
            .then((plaintext) => onUpdate({ status: 'done', content: plaintext }))
            .catch((e) =>
              onUpdate({
                status: 'error',
                message: e instanceof Error ? e.message : 'Could not decrypt the unlocked article',
              }),
            )
          return
        }
        const status = event.tags.find((t) => t[0] === 'status')?.[1]
        if (status === 'payment-required') {
          const amountTag = event.tags.find((t) => t[0] === 'amount')
          const payeeTag = event.tags.find((t) => t[0] === 'payee')?.[1]
          onUpdate({
            status: 'payment-required',
            payee: payeeTag === 'author' ? 'author' : 'nostras',
            amountMsat: Number(amountTag?.[1] ?? 0),
            invoice: amountTag?.[2] ?? '',
          })
        } else if (status === 'error') {
          onUpdate({ status: 'error', message: event.content || 'Unlock failed' })
        } else if (status === 'processing') {
          onUpdate({ status: 'processing' })
        }
      })

      await withTimeout(
        request.publish(devPublishRelaySet, PAID_ARTICLE_TIMEOUT_MS),
        PAID_ARTICLE_TIMEOUT_MS,
        'Timed out sending the unlock request',
      )
    } catch (e) {
      onUpdate({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not send unlock request',
      })
    }
  })()

  return () => {
    stopped = true
    sub?.stop()
  }
}
