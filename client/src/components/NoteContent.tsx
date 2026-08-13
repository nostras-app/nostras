import { useState } from 'react'
import { parseContentSegments, shortenUrl } from '../lib/parseContent'
import { MentionLink } from './MentionLink'
import { WarningIcon } from './icons'

const TRUNCATE_AT = 400

// Cuts at the last space before the limit (not mid-word/mid-URL) so a
// truncated preview never leaves a broken link fragment behind.
function truncateSafely(content: string, limit: number) {
  if (content.length <= limit) return { text: content, truncated: false }
  const slice = content.slice(0, limit)
  const lastSpace = slice.lastIndexOf(' ')
  const safeSlice = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice
  return { text: safeSlice.trimEnd(), truncated: true }
}

export function NoteContent({
  content,
  contentWarning,
  tags,
}: {
  content: string
  // NIP-36: null/undefined means not marked sensitive at all; '' means
  // marked sensitive with no reason given; any other string is the
  // author's stated reason. See lib/contentWarning.ts.
  contentWarning?: string | null
  // NIP-30: the source event's own tags, so parseContentSegments can
  // resolve :shortcode: custom emoji against this event's ["emoji", ...]
  // tags — scoped to the emitting event, not a global registry.
  tags?: string[][]
}) {
  const [expanded, setExpanded] = useState(false)
  // Gate starts closed for any sensitive note — "hide until acted on"
  // is NIP-36's own stated expectation, not a stricter choice made here.
  const [revealed, setRevealed] = useState(false)
  const { text: preview, truncated } = truncateSafely(content, TRUNCATE_AT)

  if (contentWarning != null && !revealed) {
    return (
      <div className="note-content">
        <div className="content-warning-gate">
          <WarningIcon className="content-warning-icon" />
          <span className="content-warning-text">
            {contentWarning ? `Marked sensitive: ${contentWarning}` : 'Marked as sensitive content'}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setRevealed(true)}
          >
            Show anyway
          </button>
        </div>
      </div>
    )
  }

  const displayContent = expanded || !truncated ? content : preview
  const segments = parseContentSegments(displayContent, tags ?? [])
  const textSegments = segments.filter(
    (s) => s.type === 'text' || s.type === 'link' || s.type === 'mention' || s.type === 'emoji',
  )
  // Media stays hidden until a truncated note is expanded, so a long note
  // doesn't load heavy content the reader hasn't opted into yet.
  const showMedia = expanded || !truncated
  const mediaSegments = showMedia
    ? segments.filter(
        (s) => s.type === 'image' || s.type === 'video' || s.type === 'audio',
      )
    : []

  return (
    <div className="note-content">
      <p className="feed-item-content">
        {textSegments.map((seg, i) => {
          if (seg.type === 'link') {
            return (
              <a
                key={i}
                href={seg.url}
                target="_blank"
                rel="noopener noreferrer"
                className="note-link"
              >
                {shortenUrl(seg.url)}
              </a>
            )
          }
          if (seg.type === 'mention') {
            return <MentionLink key={i} decoded={seg.decoded} />
          }
          if (seg.type === 'emoji') {
            return (
              <img
                key={i}
                src={seg.url}
                alt={`:${seg.shortcode}:`}
                title={`:${seg.shortcode}:`}
                className="inline-emoji"
                loading="lazy"
                onError={(e) => {
                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                }}
              />
            )
          }
          return <span key={i}>{seg.value}</span>
        })}
        {truncated && !expanded && '…'}
      </p>

      {mediaSegments.length > 0 && (
        <div className="note-media">
          {mediaSegments.map((seg, i) => {
            if (seg.type === 'image') {
              return (
                <img
                  key={i}
                  src={seg.url}
                  alt=""
                  loading="lazy"
                  className="note-media-image"
                  onLoad={(e) => {
                    e.currentTarget.classList.add('is-loaded')
                  }}
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display =
                      'none'
                  }}
                />
              )
            }
            if (seg.type === 'video') {
              return (
                <video
                  key={i}
                  src={seg.url}
                  controls
                  className="note-media-video"
                />
              )
            }
            return (
              <audio
                key={i}
                src={seg.url}
                controls
                className="note-media-audio"
              />
            )
          })}
        </div>
      )}

      {truncated && (
        <button
          type="button"
          className="show-more-btn"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
