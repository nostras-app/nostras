const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

const rtf = new Intl.RelativeTimeFormat('en', { style: 'narrow' })

export function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) return 'now'

  for (const [unit, secondsInUnit] of UNITS) {
    const value = Math.floor(diff / secondsInUnit)
    if (value >= 1) return rtf.format(-value, unit)
  }
  return 'now'
}
