export type ContentSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; url: string }
  | { type: 'image'; url: string }
  | { type: 'video'; url: string }
  | { type: 'audio'; url: string }

const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|avif|bmp|svg)(\?.*)?$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac)(\?.*)?$/i

// Splits note content into text and URL segments, classifying each URL by
// file extension so the UI can render images/video/audio inline instead of
// as raw links. This is simple extension-sniffing (not NIP-92 imeta tags) —
// covers the common case without requiring the publisher to have tagged
// media metadata.
export function parseContentSegments(content: string): ContentSegment[] {
  return content
    .split(URL_SPLIT_RE)
    .filter((part) => part.length > 0)
    .map((part): ContentSegment => {
      if (!/^https?:\/\//.test(part)) {
        return { type: 'text', value: part }
      }
      if (IMAGE_EXT_RE.test(part)) return { type: 'image', url: part }
      if (VIDEO_EXT_RE.test(part)) return { type: 'video', url: part }
      if (AUDIO_EXT_RE.test(part)) return { type: 'audio', url: part }
      return { type: 'link', url: part }
    })
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
