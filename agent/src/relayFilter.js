// Ported verbatim (logic unchanged, types dropped) from
// client/src/lib/relayFilter.ts — see that file's own comment for the
// full rationale. Reused here because NDKRelaySet.fromRelayUrls() bypasses
// NDK's pool-level relayConnectionFilter entirely (already proven in
// client/src/lib/dm.ts), and this daemon does the exact same kind of
// untrusted relay-hint discovery (a recipient's kind:10050/10002 list)
// that motivated the original fix — arguably more relevant here, since
// this is a real desktop process with a real local network to probe if a
// discovered relay list ever pointed somewhere private.
export function isPrivateOrLocalHostname(hostname) {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '::1') return true

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (a === 127) return true // loopback
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // link-local
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10) — prefix check,
  // not a full parser, but good enough to catch the common forms.
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true

  return false
}

export function makeRelayConnectionFilter(allowedLocalRelayUrl) {
  let allowedHost = null
  try {
    const u = new URL(allowedLocalRelayUrl)
    allowedHost = `${u.hostname}:${u.port}`
  } catch {
    allowedHost = null
  }

  return function isAllowedRelayConnection(relayUrl) {
    let parsed
    try {
      parsed = new URL(relayUrl)
    } catch {
      return false // malformed relay URL — reject rather than risk a bad connect attempt
    }

    if (!isPrivateOrLocalHostname(parsed.hostname)) return true

    return allowedHost !== null && `${parsed.hostname}:${parsed.port}` === allowedHost
  }
}
