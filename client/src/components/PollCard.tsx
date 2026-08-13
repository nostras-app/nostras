import { useState } from 'react'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useProfile } from '../hooks/useProfile'
import { useActiveUser } from '../hooks/useActiveUser'
import { usePollVotes } from '../hooks/usePollVotes'
import { formatRelativeTime } from '../lib/time'
import { viewProfile } from '../lib/navigation'
import { parsePollMeta, isPollEnded, publishVote, formatEndsIn } from '../lib/poll'
import { NoteMenu } from './NoteMenu'

// NIP-88 poll card. Vote counts come from real kind:1018 response
// events tagging this poll (usePollVotes), deduped per NIP-88's own
// "most recent vote per pubkey wins" rule — not session-local optimism
// the way like/repost elsewhere in this app are, since a poll's whole
// point is showing real aggregate results.
export function PollCard({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey)
  const activeUser = useActiveUser()
  const meta = parsePollMeta(event)
  const authorLabel = profile?.name || profile?.displayName || `${event.author.npub.slice(0, 12)}…`
  const { counts, totalVoters, myVote } = usePollVotes(event.id, activeUser?.pubkey)
  const [selected, setSelected] = useState<string[]>([])
  const [voting, setVoting] = useState(false)
  const [error, setError] = useState('')

  const ended = isPollEnded(meta)
  const hasVoted = !!myVote
  const showResults = ended || hasVoted

  function toggleOption(id: string) {
    if (meta.polltype === 'singlechoice') {
      setSelected([id])
    } else {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    }
  }

  async function handleVote() {
    if (selected.length === 0 || voting) return
    setVoting(true)
    setError('')
    try {
      await publishVote(event, selected)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit vote')
    } finally {
      setVoting(false)
    }
  }

  return (
    <li className="feed-item poll-card">
      <div className="feed-item-meta">
        <button type="button" className="feed-item-name-btn" onClick={() => viewProfile(event.pubkey)}>
          <span className="feed-item-name">{authorLabel}</span>
        </button>
        {event.created_at && <span className="feed-item-time">{formatRelativeTime(event.created_at)}</span>}
        <NoteMenu event={event} />
      </div>

      <p className="poll-question">{meta.question}</p>

      <div className="poll-options">
        {meta.options.map((opt) => {
          const count = counts[opt.id] ?? 0
          const percent = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0
          const isSelected = selected.includes(opt.id)
          const isMyVote = myVote?.optionIds.includes(opt.id) ?? false

          if (showResults) {
            return (
              <div key={opt.id} className={`poll-option-result${isMyVote ? ' poll-option-mine' : ''}`}>
                <div className="poll-option-result-row">
                  <span>{opt.label}{isMyVote ? ' ✓' : ''}</span>
                  <span>{percent}%</span>
                </div>
                <div className="poll-option-bar-track">
                  <div className="poll-option-bar-fill" style={{ width: `${percent}%` }} />
                </div>
              </div>
            )
          }

          return (
            <label key={opt.id} className="poll-option-input">
              <input
                type={meta.polltype === 'singlechoice' ? 'radio' : 'checkbox'}
                name={`poll-${event.id}`}
                checked={isSelected}
                onChange={() => toggleOption(opt.id)}
              />
              {opt.label}
            </label>
          )
        })}
      </div>

      <p className="poll-meta-line">
        {totalVoters} {totalVoters === 1 ? 'vote' : 'votes'}
        {ended ? ' · Poll ended' : meta.endsAt ? ` · Ends in ${formatEndsIn(meta.endsAt)}` : ''}
      </p>

      {!showResults && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleVote}
          disabled={selected.length === 0 || voting}
        >
          {voting ? 'Voting…' : 'Vote'}
        </button>
      )}

      {error && <p className="alert-error">{error}</p>}
    </li>
  )
}
