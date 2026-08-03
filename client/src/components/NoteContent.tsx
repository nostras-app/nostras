import { useState } from 'react'
import { parseContentSegments, shortenUrl } from '../lib/parseContent'

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

export function NoteContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const { text: preview, truncated } = truncateSafely(content, TRUNCATE_AT)

  const displayContent = expanded || !truncated ? content : preview
  const segments = parseContentSegments(displayContent)
  const textSegments = segments.filter(
    (s) => s.type === 'text' || s.type === 'link',
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
        {textSegments.map((seg, i) =>
          seg.type === 'link' ? (
            <a
              key={i}
              href={seg.url}
              target="_blank"
              rel="noopener noreferrer"
              className="note-link"
            >
              {shortenUrl(seg.url)}
            </a>
          ) : (
            <span key={i}>{seg.value}</span>
          ),
        )}
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
