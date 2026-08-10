import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { setActiveView } from '../lib/navigation'
import { useReplies } from '../hooks/useReplies'
import { ArrowLeftIcon } from './icons'
import { FeedItem } from './Feed'

// Opened from SearchView (pasting a note/nevent reference), a future
// nevent deep link, or EngagementBar's own reply-count click — reuses
// FeedItem directly so a note opened this way looks and behaves exactly
// like one encountered in the feed: same reply/like/repost/zap/bookmark
// engagement bar, same inline reply composer, nothing reimplemented.
// Closes a real, previously-documented gap (see lib/navigation.ts's
// viewNote) rather than adding a new, parallel rendering path.
//
// Also renders the note's direct replies underneath, each as its own
// FeedItem — this is the actual "who commented" thread view. Only one
// level deep (direct replies, not a recursive reply-tree): clicking a
// reply's own reply-count re-navigates here for *that* note, which is a
// reasonable way to drill further rather than a materially bigger
// nested-thread-renderer this wasn't asking for.
export function SingleNoteView({ event }: { event: NDKEvent }) {
  const replies = useReplies(event.id)

  return (
    <div className="single-note-view">
      <button type="button" className="dm-back-btn" onClick={() => setActiveView('home')} title="Back">
        <ArrowLeftIcon />
      </button>
      <ul className="feed">
        <FeedItem event={event} />
      </ul>
      {replies.length > 0 && (
        <>
          <p className="single-note-replies-heading">
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </p>
          <ul className="feed">
            {replies.map((reply) => (
              <FeedItem key={reply.id} event={reply} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
