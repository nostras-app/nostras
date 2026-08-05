// Blocks the client from connecting to relays that resolve to a private or
// local-network address, UNLESS it's our own explicitly configured local
// relay. This matters for two real reasons, not just tidiness:
//
// 1. NDK's own outbox-model aggregation (useTemporaryRelay) adds relays
//    discovered from OTHER users' NIP-65 lists automatically — untrusted
//    third-party data. A real public relay is never legitimately hosted at
//    a private/loopback address from another visitor's point of view; a
//    relay URL like that in someone else's kind:10002 is either garbage,
//    a misconfigured client, or an attempt to get visitors' browsers to
//    probe their own local network.
// 2. Directly observed causing a real, confusing symptom: a live browser
//    picked up `ws://127.0.0.1:4869/` from outbox discovery, which made
//    Chrome flag the whole page "Not Secure" (its Local Network Access
//    protection correctly treating an outbound connection to a private
//    address from a public HTTPS page as suspicious) — not a TLS/cert
//    problem, the cert was and is fully valid.
function isPrivateOrLocalHostname(hostname: string): boolean {
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

export function makeRelayConnectionFilter(allowedLocalRelayUrl: string) {
  let allowedHost: string | null = null
  try {
    const u = new URL(allowedLocalRelayUrl)
    allowedHost = `${u.hostname}:${u.port}`
  } catch {
    allowedHost = null
  }

  return function isAllowedRelayConnection(relayUrl: string): boolean {
    let parsed: URL
    try {
      parsed = new URL(relayUrl)
    } catch {
      return false // malformed relay URL — reject rather than risk a bad connect attempt
    }

    if (!isPrivateOrLocalHostname(parsed.hostname)) return true

    return allowedHost !== null && `${parsed.hostname}:${parsed.port}` === allowedHost
  }
}
