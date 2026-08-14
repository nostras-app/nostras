import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { parseThreadMeta } from '../lib/forum'
import { formatRelativeTime } from '../lib/time'
import { setActiveView, viewProfile } from '../lib/navigation'
import { isSecureImageUrl } from '../lib/parseContent'
import { getContentWarningReason } from '../lib/contentWarning'
import { ArrowLeftIcon } from './icons'
import { NoteMenu } from './NoteMenu'
import { NoteContent } from './NoteContent'
import { CommentSection } from './CommentSection'

// NIP-7D forum thread reading view — mirrors ArticleView's shell (back
// button, author row + menu, then replies) minus anything article-
// specific (no cover image field in the spec, no markdown body, no
// paywall). Content goes through NoteContent (the same renderer kind:1
// notes use) rather than plain text, so URLs/mentions/inline media and
// the NIP-36 content-warning gate all work here too — a forum post is
// closer to a note in shape than to a long-form article. Replies are
// real NIP-22 kind:1111 comments via the existing CommentSection,
// reused unchanged — see lib/comments.ts's isAddressableKind branch for
// why a thread's replies use E/e tags instead of an article's A/a.
export function ThreadView({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const meta = parseThreadMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`

  return (
    <div className="article-view">
      <button type="button" className="dm-back-btn" onClick={() => setActiveView('home')} title="Back">
        <ArrowLeftIcon />
      </button>

      <h1 className="article-view-title">{meta.title}</h1>

      <div className="article-view-author-row">
        <button type="button" className="article-view-author" onClick={() => viewProfile(event.pubkey)}>
          {isSecureImageUrl(profile?.picture) ? (
            <img className="avatar" src={profile.picture} alt="" />
          ) : (
            <span className="avatar-fallback">{authorLabel.charAt(0)}</span>
          )}
          <span className="feed-item-name">{authorLabel}</span>
          {event.created_at && (
            <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>
          )}
        </button>
        <NoteMenu event={event} />
      </div>

      <div className="article-view-content">
        <NoteContent
          content={event.content}
          contentWarning={getContentWarningReason(event.tags)}
          tags={event.tags}
        />
      </div>

      <CommentSection rootEvent={event} />
    </div>
  )
}
