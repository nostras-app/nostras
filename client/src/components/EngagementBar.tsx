import { useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKEvent as NDKEventType } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useEventCount, useReactionList } from '../hooks/useEventCount'
import { useBookmark } from '../hooks/useBookmark'
import { viewNote } from '../lib/navigation'
import { getSubject, replySubject } from '../lib/subject'
import { ZapButton } from './ZapButton'
import { TranslateButton } from './TranslateButton'
import { NoteMenu } from './NoteMenu'
import { EngagementListModal } from './EngagementListModal'
import {
  ReplyIcon,
  RepostIcon,
  HeartIcon,
  BookmarkIcon,
  ServerIcon,
} from './icons'

export function EngagementBar({ event }: { event: NDKEventType }) {
  const replyCount = useEventCount(event.id, 1)
  const { count: likeCount, pubkeys: likePubkeys } = useReactionList(event.id, 7)
  const { count: repostCount, pubkeys: repostPubkeys } = useReactionList(event.id, 6)
  const {
    isBookmarked,
    toggle: toggleBookmark,
    busy: bookmarkBusy,
    loading: bookmarkLoading,
    error: bookmarkError,
  } = useBookmark(event.id)

  const [liked, setLiked] = useState(false)
  const [reposted, setReposted] = useState(false)
  const [replying, setReplying] = useState(false)
  const [replyText, setReplyText] = useState('')
  // NIP-14: prefilled from the parent's own subject (with "Re: " adorned
  // per the spec) when opening a reply, editable, omitted entirely if
  // left blank — see lib/subject.ts.
  const [replySubjectText, setReplySubjectText] = useState('')
  const [busy, setBusy] = useState(false)
  const [listModal, setListModal] = useState<'likes' | 'reposts' | null>(null)

  async function handleLike() {
    if (liked || busy) return
    setBusy(true)
    try {
      const reaction = new NDKEvent(ndk, {
        kind: 7,
        content: '+',
        tags: [
          ['e', event.id],
          ['p', event.pubkey],
        ],
      })
      await reaction.publish(devPublishRelaySet)
      setLiked(true)
    } finally {
      setBusy(false)
    }
  }

  async function handleRepost() {
    if (reposted || busy) return
    setBusy(true)
    try {
      const repost = new NDKEvent(ndk, {
        kind: 6,
        content: JSON.stringify(event.rawEvent()),
        tags: [
          ['e', event.id],
          ['p', event.pubkey],
        ],
      })
      await repost.publish(devPublishRelaySet)
      setReposted(true)
    } finally {
      setBusy(false)
    }
  }

  function openReply() {
    if (!replying) setReplySubjectText(replySubject(getSubject(event.tags)) ?? '')
    setReplying((v) => !v)
  }

  async function handleReply() {
    if (!replyText.trim() || busy) return
    setBusy(true)
    try {
      const tags: string[][] = [
        ['e', event.id, '', 'reply'],
        ['p', event.pubkey],
      ]
      if (replySubjectText.trim()) tags.push(['subject', replySubjectText.trim()])
      const reply = new NDKEvent(ndk, {
        kind: 1,
        content: replyText,
        tags,
      })
      await reply.publish(devPublishRelaySet)
      setReplyText('')
      setReplySubjectText('')
      setReplying(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="engagement-bar">
      <div className="engagement-row">
        <span className="engage-btn engage-btn-reply">
          <button
            type="button"
            className="engage-btn-icon"
            onClick={openReply}
            aria-label="Reply"
          >
            <ReplyIcon />
          </button>
          {replyCount > 0 && (
            <button
              type="button"
              className="engage-count"
              onClick={() => viewNote(event)}
              title="See who replied"
            >
              {replyCount}
            </button>
          )}
        </span>
        <span className={`engage-btn engage-btn-repost${reposted ? ' engage-btn-active' : ''}`}>
          <button
            type="button"
            className="engage-btn-icon"
            onClick={handleRepost}
            disabled={reposted || busy}
            aria-label="Repost"
          >
            <RepostIcon />
          </button>
          {repostCount > 0 && (
            <button
              type="button"
              className="engage-count"
              onClick={() => setListModal('reposts')}
              title="See who reposted"
            >
              {repostCount}
            </button>
          )}
        </span>
        <span className={`engage-btn engage-btn-like${liked ? ' engage-btn-active' : ''}`}>
          <button
            type="button"
            className="engage-btn-icon"
            onClick={handleLike}
            disabled={liked || busy}
            aria-label="Like"
          >
            <HeartIcon filled={liked} />
          </button>
          {likeCount > 0 && (
            <button
              type="button"
              className="engage-count"
              onClick={() => setListModal('likes')}
              title="See who liked"
            >
              {likeCount}
            </button>
          )}
        </span>
        <ZapButton event={event} />
        <button
          type="button"
          className={`engage-btn engage-btn-bookmark${isBookmarked ? ' engage-btn-active' : ''}`}
          onClick={toggleBookmark}
          disabled={bookmarkBusy || bookmarkLoading}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
        >
          <BookmarkIcon filled={isBookmarked} />
        </button>
        <span className="seen-on-relays" title="Seen on this many relays">
          <ServerIcon />
          {event.onRelays.length}
        </span>
        <TranslateButton event={event} />
        <NoteMenu event={event} />
        {bookmarkError && <span className="alert-error engage-error">{bookmarkError}</span>}
      </div>

      {replying && (
        <div className="reply-composer">
          <input
            type="text"
            className="input"
            value={replySubjectText}
            onChange={(e) => setReplySubjectText(e.target.value)}
            placeholder="Subject (optional)"
            maxLength={80}
          />
          <textarea
            className="textarea"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Reply…"
            rows={2}
          />
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleReply}
              disabled={busy || !replyText.trim()}
            >
              Reply
            </button>
          </div>
        </div>
      )}

      {listModal && (
        <EngagementListModal
          title={listModal === 'likes' ? 'Liked by' : 'Reposted by'}
          entries={(listModal === 'likes' ? likePubkeys : repostPubkeys).map((pubkey) => ({ pubkey }))}
          onClose={() => setListModal(null)}
        />
      )}
    </div>
  )
}
