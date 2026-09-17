import { NDKEvent, type NDKKind } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, authorQueryRelaySet, localRelaySet } from './ndk'
import { fetchLatestReplaceableEvent } from './fetchLatestReplaceable'
import { withTimeout } from './podcast'
import { requestDvmJob, type DvmJobUpdate } from './dvm'

// A NOSTRAS-specific job board offer. Deliberately a separate kind from
// NIP-99's classified listing (30402), not a reuse of it with a "t:job"
// tag — a job offer is semantically the reverse of a listing (the
// poster pays someone else to do work, they aren't selling a good), and
// a real third-party NIP-99 marketplace client (Shopstr, Plebeian
// Market) would otherwise render a job post as a literal product for
// sale. Not in NDK's own kind catalog — same gap already hit for every
// other project-specific kind this app has added (poll, forum thread,
// podcast episode, zap goal, listing).
//
// 32406, not 30406 — a real, live collision found during this feature's
// own local verification, not theoretical: 30406 (the original pick,
// checked only against this project's own used kinds and NDK's
// catalog) turned out to already be in active real-world use by at
// least one unrelated app (a live kind:30406 feed of shipping-option
// listings, e.g. "Standard Shipping"/merchant pickup events, showed up
// mixed into this app's own Job Board view once a dev client subscribed
// across the live pool) — and the whole neighboring 30400s range
// (30404-30410, 30412, 30415, 30420+) turned out to be similarly
// occupied by other real apps. 32406 was checked live against 12 major
// public relays (not just NDK's catalog) with zero hits before being
// chosen.
export const KIND_JOB_OFFER = 32406 as NDKKind

// Job board completion payment — the client half of the
// server/cmd/dvm/main.go job kind of the same name. Not cast to NDKKind
// since these are only ever used as plain numbers in requestDvmJob's
// options, never in an NDK subscription filter.
export const KIND_JOB_REQUEST_COMPLETION_PAYMENT = 5908
export const KIND_JOB_RESULT_COMPLETION_PAYMENT = 6908

const PUBLISH_TIMEOUT_MS = 8000
const FETCH_TIMEOUT_MS = 8000

export type JobMeta = {
  title: string
  description: string
  rewardAmount: string
  rewardCurrency: string
  categories: string[]
  status: 'open' | 'paid'
  publishedAt: number | null
}

export function parseJobMeta(event: NDKEvent): JobMeta {
  const tag = (name: string) => event.tags.find((t) => t[0] === name)
  const rewardTag = tag('reward')
  const publishedAtTag = tag('published_at')?.[1]
  return {
    title: tag('title')?.[1] ?? '',
    description: event.content,
    rewardAmount: rewardTag?.[1] ?? '',
    rewardCurrency: rewardTag?.[2] ?? '',
    categories: event.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]),
    status: tag('status')?.[1] === 'paid' ? 'paid' : 'open',
    publishedAt: publishedAtTag ? Number(publishedAtTag) : null,
  }
}

export type PublishJobInput = {
  title: string
  description: string
  rewardAmount: string
  rewardCurrency: string
  categories: string[]
}

export async function publishJobOffer(input: PublishJobInput): Promise<NDKEvent> {
  const tags: string[][] = [
    ['d', crypto.randomUUID()],
    ['title', input.title.trim()],
    ['reward', input.rewardAmount.trim(), input.rewardCurrency.trim()],
    ['status', 'open'],
    ['published_at', String(Math.floor(Date.now() / 1000))],
  ]
  for (const category of input.categories) {
    if (category.trim()) tags.push(['t', category.trim()])
  }

  const event = new NDKEvent(ndk, { kind: KIND_JOB_OFFER, content: input.description.trim(), tags })
  await event.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
  return event
}

// Owner-only status update — "Mark as paid," the only state transition
// a job offer ever needs (there's no separate "accepted applicant"
// state — see requestJobCompletionPayment's own comment). Same
// fetch-then-merge discipline as publishListingStatusUpdate
// (lib/listing.ts): fetches the *current* copy first
// (fetchLatestReplaceableEvent, not a plain ndk.fetchEvent() — the same
// closeOnEose race this project has found and fixed repeatedly for
// other replaceable kinds) rather than trusting whatever copy the
// caller already has in memory, and preserves every tag this function
// doesn't explicitly touch.
export async function publishJobStatusUpdate(
  event: NDKEvent,
  status: 'open' | 'paid',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
  if (!dTag) return { ok: false, error: 'This job has no d tag — cannot edit it' }

  const current = await withTimeout(
    fetchLatestReplaceableEvent(
      { kinds: [KIND_JOB_OFFER], authors: [event.pubkey], '#d': [dTag] },
      authorQueryRelaySet,
    ),
    FETCH_TIMEOUT_MS,
    'Timed out fetching the current job offer',
  ).catch(() => null)

  const base = current ?? event
  const tags = base.tags.filter((t) => t[0] !== 'status')
  tags.push(['status', status])

  try {
    const updated = new NDKEvent(ndk, { kind: KIND_JOB_OFFER, content: base.content, tags })
    await updated.publish(devPublishRelaySet, PUBLISH_TIMEOUT_MS)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to update job' }
  }
}

// Thin wrapper around the generic requestDvmJob(), same shape as
// requestGroupJoin/requestListingPurchase — scoped to localRelaySet
// since this job only makes sense against NOSTRAS's own DVM. Unlike
// requestListingPurchase (any buyer may pay any seller), only the job
// offer's own poster is authorized to trigger this — enforced server-
// side (server/cmd/dvm/main.go's handleJobCompletionPaymentJob), not
// hidden here. workerPubkey is whichever applicant (NIP-22 comment
// author) the poster picked in the UI — there's no separate "accept"
// step or persisted tag recording that choice; paying them directly
// is the only state transition this app models.
export function requestJobCompletionPayment(
  jobId: string,
  workerPubkey: string,
  onUpdate: (update: DvmJobUpdate) => void,
): () => void {
  return requestDvmJob({
    requestKind: KIND_JOB_REQUEST_COMPLETION_PAYMENT,
    resultKind: KIND_JOB_RESULT_COMPLETION_PAYMENT,
    inputText: jobId,
    params: [['worker', workerPubkey]],
    onUpdate,
    relaySet: localRelaySet,
  })
}
