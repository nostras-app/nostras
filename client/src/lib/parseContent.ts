import { nip19 } from '@nostr-dev-kit/ndk'

// NIP-27 mentions this app is willing to render specially — deliberately
// excludes nsec/ncryptsec/nrelay even though nip19.decode() would happily
// decode them too: nsec/ncryptsec are private-key material that should
// never be treated as a clickable "mention" (or given any rendering
// attention at all beyond falling through to plain text, same as any
// other unrecognized token), and nrelay has no NIP-27 mention meaning.
// Fails closed to plain text for anything not in this list, not just
// anything that fails to decode.
export type MentionDecoded =
  | { type: 'npub'; data: string }
  | { type: 'nprofile'; data: { pubkey: string; relays?: string[] } }
  | { type: 'note'; data: string }
  | { type: 'nevent'; data: { id: string; relays?: string[]; author?: string; kind?: number } }
  | { type: 'naddr'; data: { identifier: string; pubkey: string; kind: number; relays?: string[] } }

export type ContentSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; url: string }
  | { type: 'image'; url: string }
  | { type: 'video'; url: string }
  | { type: 'audio'; url: string }
  | { type: 'mention'; decoded: MentionDecoded }

// NIP-27: mentions appear as nostr: URIs wrapping a NIP-19 (bech32) code —
// only the nostr: form is matched (not a bare npub1.../note1... sitting in
// plain text with no scheme), matching the spec's own actual convention.
// [a-z0-9]+ is a superset of bech32's real charset (safe: nip19.decode()
// below is the actual validator, this regex only needs to capture the
// token boundary).
const CONTENT_SPLIT_RE =
  /(https?:\/\/[^\s]+|nostr:(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+)/g
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|avif|bmp|svg)(\?.*)?$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac)(\?.*)?$/i

function decodeMention(bech32: string): MentionDecoded | null {
  try {
    const decoded = nip19.decode(bech32)
    switch (decoded.type) {
      case 'npub':
      case 'nprofile':
      case 'note':
      case 'nevent':
      case 'naddr':
        return decoded as MentionDecoded
      default:
        return null
    }
  } catch {
    return null
  }
}

// Splits note content into text and URL segments, classifying each URL by
// file extension so the UI can render images/video/audio inline instead of
// as raw links. This is simple extension-sniffing (not NIP-92 imeta tags) —
// covers the common case without requiring the publisher to have tagged
// media metadata.
//
// Real bug (2026-08-10): only https:// URLs are eligible for inline
// image/video/audio embedding — a plain http:// media URL, however
// classified by extension, still comes back as a 'link' segment instead.
// Rendering it as a real <img>/<video>/<audio> element makes the browser
// issue an actual insecure subresource fetch from this HTTPS page (genuine
// active/passive mixed content, confirmed directly via a real Chrome
// console warning: "Mixed Content: ... requested an insecure element
// 'http://...png'"), which is what was flagging the whole page "Not
// secure" — not anything in NOSTRAS's own connections, not a browser
// extension (both were directly ruled out first), just a stranger's post
// containing a non-HTTPS media URL, rendered faithfully. Note content is
// otherwise-untrusted third-party input by design, same category as an
// outbox-discovered relay URL — this is that same "don't let untrusted
// data make the browser do something insecure" principle, applied to
// rendering instead of networking. A plain link still lets a reader open
// the media themselves; it just isn't auto-embedded.
export function parseContentSegments(content: string): ContentSegment[] {
  return content
    .split(CONTENT_SPLIT_RE)
    .filter((part) => part.length > 0)
    .map((part): ContentSegment => {
      if (part.startsWith('nostr:')) {
        const decoded = decodeMention(part.slice('nostr:'.length))
        if (decoded) return { type: 'mention', decoded }
        return { type: 'text', value: part }
      }
      if (!/^https?:\/\//.test(part)) {
        return { type: 'text', value: part }
      }
      const isSecure = /^https:\/\//.test(part)
      if (isSecure && IMAGE_EXT_RE.test(part)) return { type: 'image', url: part }
      if (isSecure && VIDEO_EXT_RE.test(part)) return { type: 'video', url: part }
      if (isSecure && AUDIO_EXT_RE.test(part)) return { type: 'audio', url: part }
      return { type: 'link', url: part }
    })
}

// Same http:// mixed-content principle as parseContentSegments above,
// applied to profile.picture/profile.banner — kind:0 fields are just as
// untrusted as note content (any Nostr user can publish anything there),
// and every avatar/banner in this app was rendering them as a raw <img
// src> with no scheme check at all. This is the more pervasive instance
// of the same bug: an avatar renders on nearly every screen, so this was
// plausibly hit even more often than the note-content case. Reused across
// every avatar/banner call site instead of duplicating the check.
export function isSecureImageUrl(url: string | null | undefined): url is string {
  return !!url && /^https:\/\//.test(url)
}

export function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path =
      parsed.pathname.length > 20
        ? parsed.pathname.slice(0, 20) + '…'
        : parsed.pathname
    return parsed.hostname + path
  } catch {
    return url.length > 40 ? url.slice(0, 40) + '…' : url
  }
}
