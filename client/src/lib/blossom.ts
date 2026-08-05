import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk } from './ndk'

// blossom.primal.net — confirmed (via a real test upload) to accept open
// uploads with no allowlisting. Not yet user-configurable (matching the
// "bring your own relay" pattern elsewhere in this app would be a natural
// follow-up, not built this pass).
const BLOSSOM_SERVER = 'https://blossom.primal.net'

export type BlobDescriptor = {
  url: string
  sha256: string
  size: number
  type: string
  uploaded: number
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// BUD-11 specifies base64url *without* padding for this header, but a
// real test against blossom.primal.net (this app's actual server) found
// it rejects that with "invalid base64 for auth event" and only accepts
// standard base64 (with padding) — same encoding NIP-98 uses. Matching
// what the real server actually accepts, not the spec text, since that's
// what was verified end-to-end.
function base64Encode(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// Blossom's own auth event kind (24242, per BUD-11) — distinct from
// NIP-98's 27235 used for the relay's push-subscription endpoints
// (lib/pushNotifications.ts). Scoped to this exact file's hash via the
// `x` tag and a short expiry, per spec.
async function buildBlossomAuthHeader(sha256: string): Promise<string> {
  const event = new NDKEvent(ndk, {
    kind: 24242,
    content: 'Upload file',
    tags: [
      ['t', 'upload'],
      ['x', sha256],
      ['expiration', String(Math.floor(Date.now() / 1000) + 300)],
    ],
  })
  await event.sign()
  return `Nostr ${base64Encode(JSON.stringify(event.rawEvent()))}`
}

export async function uploadToBlossom(file: File): Promise<BlobDescriptor> {
  const sha256 = await sha256Hex(file)
  const authHeader = await buildBlossomAuthHeader(sha256)

  const res = await fetch(`${BLOSSOM_SERVER}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  })
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`)
  }
  return res.json()
}
