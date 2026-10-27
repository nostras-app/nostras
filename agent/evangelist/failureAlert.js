// Decides whether a run should DM the owner about failing runs.
// 2026-10-25..27: the Claude login expired and all 10 runs over two days
// failed ("OAuth session expired") with nothing telling anyone.
//
// Alerts on the 2nd failed run in a row, then on every 4th after that
// (about once a day at 4 runs/day), and once more on the first run that
// succeeds after an alert. Skipped runs (paused, cost cap) don't count
// either way.
export const FIRST_ALERT_AFTER = 2
export const REPEAT_EVERY = 4

export function failureAlert(runs) {
  const real = runs.filter((r) => !r.skipped)
  if (real.length === 0) return null
  const failed = (r) => r.code !== 0
  const streak = (list) => {
    let n = 0
    for (let i = list.length - 1; i >= 0 && failed(list[i]); i--) n++
    return n
  }

  const latest = real[real.length - 1]
  if (!failed(latest)) {
    const before = streak(real.slice(0, -1))
    if (before < FIRST_ALERT_AFTER) return null
    return `Evangelist is running again after ${before} failed runs in a row. Latest run at ${latest.ts} succeeded.`
  }

  const n = streak(real)
  if (n < FIRST_ALERT_AFTER || (n - FIRST_ALERT_AFTER) % REPEAT_EVERY !== 0) return null
  const since = real[real.length - n].ts
  // Claude puts errors like "OAuth session expired" in its JSON result
  // (the run's summary), not on stderr.
  const error = String(latest.error || latest.summary || 'no error text').trim().split('\n')[0].slice(0, 300)
  return `Evangelist alert: ${n} runs in a row failed (since ${since}).\nLast error: ${error}\n` +
    `If it's the Claude login, run \`claude\` on the desktop and \`/login\` again. ` +
    `I'll remind you about once a day until a run succeeds.`
}
