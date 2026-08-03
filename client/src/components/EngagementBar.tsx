import { useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKEvent as NDKEventType } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useEventCount } from '../hooks/useEventCount'
import { ZapButton } from './ZapButton'

export function EngagementBar({ event }: { event: NDKEventType }) {
  const likeCount = useEventCount(event.id, 7)
  const repostCount = useEventCount(event.id, 6)
  const replyCount = useEventCount(event.id, 1)

  const [liked, setLiked] = useState(false)
  const [reposted, setReposted] = useState(false)
  const [replying, setReplying] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)

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

  async function handleReply() {
    if (!replyText.trim() || busy) return
    setBusy(true)
    try {
      const reply = new NDKEvent(ndk, {
        kind: 1,
        content: replyText,
        tags: [
          ['e', event.id, '', 'reply'],
          ['p', event.pubkey],
        ],
      })
      await reply.publish(devPublishRelaySet)
      setReplyText('')
      setReplying(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="engagement-bar">
      <div className="engagement-row">
        <button
          type="button"
          className="engage-btn"
          onClick={() => setReplying((v) => !v)}
        >
          💬 {replyCount > 0 ? replyCount : ''}
        </button>
        <button
          type="button"
          className={`engage-btn${reposted ? ' engage-btn-active' : ''}`}
          onClick={handleRepost}
          disabled={reposted || busy}
        >
          🔁 {repostCount > 0 ? repostCount : ''}
        </button>
        <button
          type="button"
          className={`engage-btn${liked ? ' engage-btn-active' : ''}`}
          onClick={handleLike}
          disabled={liked || busy}
        >
          {liked ? '❤️' : '🤍'} {likeCount > 0 ? likeCount : ''}
        </button>
        <ZapButton event={event} />
      </div>

      {replying && (
        <div className="reply-composer">
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
    </div>
  )
}
