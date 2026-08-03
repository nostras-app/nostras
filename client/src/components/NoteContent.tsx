import { useState } from 'react'
import { parseContentSegments, shortenUrl } from '../lib/parseContent'

const TRUNCATE_AT = 400

export function NoteContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = content.length > TRUNCATE_AT

  if (isLong && !expanded) {
    return (
      <div className="note-content">
        <p className="feed-item-content">
          {content.slice(0, TRUNCATE_AT).trimEnd()}…
        </p>
        <button
          type="button"
          className="show-more-btn"
          onClick={() => setExpanded(true)}
        >
          Show more
        </button>
      </div>
    )
  }

  const segments = parseContentSegments(content)
  const textSegments = segments.filter(
    (s) => s.type === 'text' || s.type === 'link',
  )
  const mediaSegments = segments.filter(
    (s) => s.type === 'image' || s.type === 'video' || s.type === 'audio',
  )

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

      {isLong && (
        <button
          type="button"
          className="show-more-btn"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      )}
    </div>
  )
}
