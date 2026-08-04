import { useState } from 'react'
import { useActiveUser } from '../hooks/useActiveUser'
import { useProfile } from '../hooks/useProfile'
import { useNoteFeed } from '../hooks/useNoteFeed'
import { useFollowCounts } from '../hooks/useFollowCounts'
import { useNip05Verified } from '../hooks/useNip05Verified'
import { useWalletBalance } from '../hooks/useWalletBalance'
import { FeedItem, FeedSkeleton } from './Feed'
import { UserIcon, CheckCircleIcon, ZapCircleIcon } from './icons'

export function ProfileView() {
  const activeUser = useActiveUser()
  const profile = useProfile(activeUser?.pubkey)
  const { events, loading } = useNoteFeed(activeUser ? [activeUser.pubkey] : undefined)
  const { following, followers } = useFollowCounts(activeUser?.pubkey)
  const nip05Verified = useNip05Verified(activeUser, profile?.nip05)
  const balanceSats = useWalletBalance()
  const [copied, setCopied] = useState(false)

  const label = profile?.name || profile?.displayName || 'Anonymous'

  function handleCopyNpub() {
    if (!activeUser) return
    navigator.clipboard.writeText(activeUser.npub)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="profile-view">
      <div className={`profile-header${profile?.banner ? ' has-banner' : ''}`}>
        {profile?.banner && (
          <img className="profile-banner" src={profile.banner} alt="" />
        )}
        <div className="profile-header-body">
          {profile?.picture ? (
            <img className="profile-avatar" src={profile.picture} alt="" />
          ) : (
            <span className="profile-avatar profile-avatar-fallback">
              <UserIcon />
            </span>
          )}
          <div className="profile-info">
            <span className="profile-name">{label}</span>
            {activeUser && (
              <button type="button" className="profile-npub" onClick={handleCopyNpub}>
                {copied ? 'Copied!' : `${activeUser.npub.slice(0, 16)}…`}
              </button>
            )}
            {profile?.about && <p className="profile-about">{profile.about}</p>}
            <div className="profile-stats">
              <span title="Based on what's visible across connected relays, not the whole network">
                <strong>{following ?? '—'}</strong> Following
              </span>
              <span title="Based on what's visible across connected relays, not the whole network">
                <strong>{followers ?? '—'}</strong> Followers
              </span>
              {profile?.nip05 && (
                <span
                  className={`profile-nip05 ${nip05Verified ? 'verified' : 'unverified'}`}
                  title={
                    nip05Verified
                      ? `Verified: ${profile.nip05}`
                      : `Could not verify ${profile.nip05} against its domain`
                  }
                >
                  <CheckCircleIcon /> {profile.nip05}
                </span>
              )}
              {balanceSats !== null && (
                <span className="profile-balance" title="Connected wallet balance">
                  <ZapCircleIcon /> {balanceSats.toLocaleString()} sats
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="profile-notes">
        {loading && events.length === 0 && <FeedSkeleton />}

        {!loading && events.length === 0 && (
          <div className="feed-empty">
            <p>No notes yet.</p>
            <p className="feed-empty-hint">Anything you publish will show up here.</p>
          </div>
        )}

        {events.length > 0 && (
          <ul className="feed">
            {events.map((event) => (
              <FeedItem key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
