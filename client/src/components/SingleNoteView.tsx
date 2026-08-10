import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { setActiveView } from '../lib/navigation'
import { ArrowLeftIcon } from './icons'
import { FeedItem } from './Feed'

// Opened from SearchView (pasting a note/nevent reference) or a future
// nevent deep link — reuses FeedItem directly so a note opened this way
// looks and behaves exactly like one encountered in the feed: same
// reply/like/repost/zap/bookmark engagement bar, same inline reply
// composer, nothing reimplemented. Closes a real, previously-documented
// gap (see lib/navigation.ts's viewNote) rather than adding a new,
// parallel rendering path.
export function SingleNoteView({ event }: { event: NDKEvent }) {
  return (
    <div className="single-note-view">
      <button type="button" className="dm-back-btn" onClick={() => setActiveView('home')} title="Back">
        <ArrowLeftIcon />
      </button>
      <ul className="feed">
        <FeedItem event={event} />
      </ul>
    </div>
  )
}
