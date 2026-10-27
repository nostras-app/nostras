import { NDKEvent, NDKUser, type NDKRelaySet, type NDKSubscription } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, localRelayUrl } from './ndk'
import { fetchNewestDvmAnnouncement } from './dvmAnnouncement'

const KIND_JOB_FEEDBACK = 7000
const DVM_PUBKEY_CACHE_MS = 10 * 60 * 1000

const PREFERRED_MODEL_KEY = 'nostras:dvm-model'

export type DvmModelPrivacy = 'local' | 'confidential' | 'third-party'

// One entry of the announcement's "models" list
// (server/cmd/dvm/llm.go, advertisedModel).
export type DvmModel = {
  id: string
  backend: string
  privacy: DvmModelPrivacy
  default?: boolean
}

export type DvmInfo = { pubkey: string; models: DvmModel[] }

let cachedDvmInfo: { info: DvmInfo; at: number } | null = null

// The NOSTRAS DVM's current identity pubkey and model list, read from its
// kind:31990 NIP-89 announcement (signed by that identity). Encrypted job
// requests are encrypted to this key.
export async function fetchDvmInfo(): Promise<DvmInfo> {
  if (cachedDvmInfo && Date.now() - cachedDvmInfo.at < DVM_PUBKEY_CACHE_MS) {
    return cachedDvmInfo.info
  }
  const newest = await fetchNewestDvmAnnouncement()
  if (!newest) throw new Error('Could not find the DVM')
  let models: DvmModel[] = []
  try {
    const content = JSON.parse(newest.content) as { models?: DvmModel[] }
    if (Array.isArray(content.models)) {
      models = content.models.filter((m) => typeof m?.id === 'string' && m.id !== '')
    }
  } catch {
    // An announcement without a readable model list still gives us the key.
  }
  const info = { pubkey: newest.pubkey, models }
  cachedDvmInfo = { info, at: Date.now() }
  return info
}

export async function fetchDvmIdentityPubkey(): Promise<string> {
  return (await fetchDvmInfo()).pubkey
}

// The model the user picked for AI jobs (Ask, translate, summarize, spam
// check), or null for the DVM's default. A per-device preference only.
export function getPreferredDvmModel(): string | null {
  try {
    return localStorage.getItem(PREFERRED_MODEL_KEY)
  } catch {
    return null
  }
}

export function setPreferredDvmModel(id: string | null) {
  try {
    if (id) localStorage.setItem(PREFERRED_MODEL_KEY, id)
    else localStorage.removeItem(PREFERRED_MODEL_KEY)
  } catch {
    // Storage unavailable (private mode): the choice just won't persist.
  }
}

export type DvmJobUpdate =
  | { status: 'processing' }
  // payee is only ever set on jobs that make two sequential payments
  // (e.g. paid communities: the group's own price, tagged "group", then
  // NOSTRAS's flat fee, untagged) — optional and unused by any
  // single-payment job kind, matching the payee tag itself being
  // present only on server/cmd/dvm/main.go's publishPaymentRequiredFor
  // calls, never on the plain publishPaymentRequired used elsewhere.
  | { status: 'payment-required'; amountMsat: number; invoice: string; payee?: string }
  | { status: 'done'; result: string }
  | { status: 'error'; message: string }

// Publishes a NIP-90 job request (e.g. kind 5002 translation), then
// listens for the DVM's kind:7000 feedback and final result event. Mirrors
// the exact tag shapes server/cmd/dvm/main.go publishes (status tag,
// amount tag [msats, bolt11], e/p tags) — this is the client half of that
// protocol. Returns a cancel function.
//
// inputText is sent as a NIP-90 "text" input (not an "event" input
// pointing at an id) deliberately: most feed notes arrive at the browser
// directly from public relays and were never published to our local
// relay, so the DVM — which only queries its own local store — can't
// resolve them by id. Sending the content directly sidesteps that
// entirely; the DVM's existing "i" tag handling already supports it
// without any server change (inputType "event" is the special case, not
// the default).
export function requestDvmJob(opts: {
  requestKind: number
  resultKind: number
  inputText: string
  params?: [string, string][]
  onUpdate: (update: DvmJobUpdate) => void
  // Defaults to devPublishRelaySet (local relay + public bootstrap
  // relays in production) — pass localRelaySet explicitly for job kinds
  // whose data is meant to stay on NOSTRAS's own relay only, e.g. group
  // joins (see lib/communities.ts).
  relaySet?: NDKRelaySet
  // NIP-90 encrypted request: the input and params are NIP-44-encrypted
  // to the DVM's identity key instead of sitting in plain tags on a
  // public event, and the DVM encrypts the result back to us. Use it for
  // anything carrying the user's own text (Ask, translate, summarize,
  // spam check). If the DVM's key can't be found, the job fails rather
  // than falling back to plaintext. Encrypted jobs also carry the user's
  // preferred model (getPreferredDvmModel) when the DVM advertises it and
  // the caller didn't pass a model param itself.
  encrypt?: boolean
}): () => void {
  const { requestKind, resultKind, inputText, params = [], onUpdate, relaySet, encrypt = false } = opts

  let stopped = false
  let sub: NDKSubscription | null = null

  const jobTags = [['i', inputText, 'text'], ...params.map(([key, value]) => ['param', key, value])]
  const request = new NDKEvent(ndk, { kind: requestKind, content: '', tags: [] })

  const prepare = async () => {
    if (!encrypt) {
      request.tags = [...jobTags, ['relays', localRelayUrl]]
      return
    }
    if (!ndk.signer) throw new Error('No signer available to encrypt the request')
    const { pubkey: dvmPubkey, models } = await fetchDvmInfo()
    const preferred = getPreferredDvmModel()
    if (preferred && !params.some(([key]) => key === 'model') && models.some((m) => m.id === preferred)) {
      jobTags.push(['param', 'model', preferred])
    }
    request.content = await ndk.signer.encrypt(new NDKUser({ pubkey: dvmPubkey }), JSON.stringify(jobTags), 'nip44')
    request.tags = [['p', dvmPubkey], ['encrypted'], ['relays', localRelayUrl]]
  }

  prepare()
    .then(() => request.sign())
    .then(async () => {
      if (stopped) return

      sub = ndk.subscribe({ kinds: [KIND_JOB_FEEDBACK, resultKind], '#e': [request.id] })
      sub.on('event', (event: NDKEvent) => {
        if (event.kind === resultKind) {
          if (!event.tags.some((t) => t[0] === 'encrypted')) {
            onUpdate({ status: 'done', result: event.content })
            return
          }
          const signer = ndk.signer
          if (!signer) {
            onUpdate({ status: 'error', message: 'No signer available to decrypt the result' })
            return
          }
          signer
            .decrypt(new NDKUser({ pubkey: event.pubkey }), event.content, 'nip44')
            .then((result) => onUpdate({ status: 'done', result }))
            .catch(() => onUpdate({ status: 'error', message: 'Could not decrypt the result' }))
          return
        }
        const status = event.tags.find((t) => t[0] === 'status')?.[1]
        if (status === 'payment-required') {
          const amountTag = event.tags.find((t) => t[0] === 'amount')
          onUpdate({
            status: 'payment-required',
            amountMsat: Number(amountTag?.[1] ?? 0),
            invoice: amountTag?.[2] ?? '',
            payee: event.tags.find((t) => t[0] === 'payee')?.[1],
          })
        } else if (status === 'error') {
          onUpdate({ status: 'error', message: event.content || 'Job failed' })
        } else if (status === 'processing') {
          onUpdate({ status: 'processing' })
        }
      })

      await request.publish(relaySet ?? devPublishRelaySet)
    })
    .catch((e) => {
      onUpdate({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not publish job request',
      })
    })

  return () => {
    stopped = true
    sub?.stop()
  }
}
