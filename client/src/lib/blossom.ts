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

// Real, previously-flagged privacy gap: uploads went out exactly as
// picked, EXIF (location, device info) and all — see the backlog entry
// this closes. Stripping happens here, not at each call site, so every
// caller (Composer, ArticleComposer, ProfileEditor) gets it for free.
//
// Re-encoding via canvas (rather than surgically removing just the EXIF
// segment) is the deliberate choice: canvas pixel data carries no
// metadata at all, so this can't miss a metadata field a hand-rolled
// binary parser might, at the cost of one extra JPEG compression pass
// (a real, if usually imperceptible, quality trade — "simple and
// broad-compatibility over precise" is the same call already made for
// media rendering in parseContent.ts). SVG is skipped — it's XML, not a
// raster format, and rasterizing it would destroy the vector content
// this app never intended to touch. Any decode failure (e.g. some HEIC
// variants Chrome can't rasterize) falls back to the original file
// rather than blocking the upload — same degrade-gracefully posture as
// every other third-party-input path in this app.
async function stripExifFromImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return file
  }
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, file.type, 0.92),
    )
    if (!blob) return file
    return new File([blob], file.name, { type: file.type })
  } catch {
    return file
  }
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
  const uploadFile = await stripExifFromImage(file)
  const sha256 = await sha256Hex(uploadFile)
  const authHeader = await buildBlossomAuthHeader(sha256)

  const res = await fetch(`${BLOSSOM_SERVER}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': uploadFile.type || 'application/octet-stream',
    },
    body: uploadFile,
  })
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`)
  }
  return res.json()
}
