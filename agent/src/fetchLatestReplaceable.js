// Ported verbatim (logic unchanged) from client/src/lib/fetchLatestReplaceable.ts
// — see that file's own comment for the full mechanism. Deliberately
// bypasses ndk.fetchEvent()/fetchEvents() entirely: both hardcode
// closeOnEose:true internally, which can converge on a stale relay's copy
// of a replaceable event (e.g. the owner's kind:10050 DM relay list)
// before a slower relay's genuinely newer one arrives. This always waits
// the full timeout window instead, tracking whichever event seen has the
// highest created_at.
export function fetchLatestReplaceableEvent(ndk, filter, relaySet, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let newest = null
    let settled = false

    const sub = ndk.subscribe(filter, { relaySet, closeOnEose: false })

    const finish = () => {
      if (settled) return
      settled = true
      sub.stop()
      resolve(newest)
    }

    sub.on('event', (event) => {
      if (!newest || (event.created_at ?? 0) > (newest.created_at ?? 0)) {
        newest = event
      }
    })

    setTimeout(finish, timeoutMs)
  })
}
