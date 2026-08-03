import { NDKEvent, type NDKSubscription } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, localRelayUrl } from './ndk'

const KIND_JOB_FEEDBACK = 7000

export type DvmJobUpdate =
  | { status: 'processing' }
  | { status: 'payment-required'; amountMsat: number; invoice: string }
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
}): () => void {
  const { requestKind, resultKind, inputText, params = [], onUpdate } = opts

  let stopped = false
  let sub: NDKSubscription | null = null

  const request = new NDKEvent(ndk, {
    kind: requestKind,
    content: '',
    tags: [
      ['i', inputText, 'text'],
      ['relays', localRelayUrl],
      ...params.map(([key, value]) => ['param', key, value]),
    ],
  })

  request
    .sign()
    .then(async () => {
      if (stopped) return

      sub = ndk.subscribe({ kinds: [KIND_JOB_FEEDBACK, resultKind], '#e': [request.id] })
      sub.on('event', (event: NDKEvent) => {
        if (event.kind === resultKind) {
          onUpdate({ status: 'done', result: event.content })
          return
        }
        const status = event.tags.find((t) => t[0] === 'status')?.[1]
        if (status === 'payment-required') {
          const amountTag = event.tags.find((t) => t[0] === 'amount')
          onUpdate({
            status: 'payment-required',
            amountMsat: Number(amountTag?.[1] ?? 0),
            invoice: amountTag?.[2] ?? '',
          })
        } else if (status === 'error') {
          onUpdate({ status: 'error', message: event.content || 'Job failed' })
        } else if (status === 'processing') {
          onUpdate({ status: 'processing' })
        }
      })

      await request.publish(devPublishRelaySet)
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
