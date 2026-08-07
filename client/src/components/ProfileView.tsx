import { useMemo, useState } from 'react'
import { ndk } from '../lib/ndk'
import { useActiveUser } from '../hooks/useActiveUser'
import { useProfile } from '../hooks/useProfile'
import { useNoteFeed } from '../hooks/useNoteFeed'
import { useFollowCounts } from '../hooks/useFollowCounts'
import { useFollowing } from '../hooks/useFollowing'
import { useNip05Verified } from '../hooks/useNip05Verified'
import { useWalletBalance } from '../hooks/useWalletBalance'
import { FeedItem, FeedSkeleton } from './Feed'
import { UserIcon, CheckCircleIcon, ZapCircleIcon } from './icons'
import { parseContentSegments, shortenUrl } from '../lib/parseContent'

// Same URL-detection parseContentSegments already uses for note content —
// reused here just for linkification (a bio doesn't get inline media
// embeds like a note does, so every non-text segment renders as a plain
// clickable link regardless of its sniffed type).
function renderAbout(about: string) {
  return parseContentSegments(about).map((seg, i) =>
    seg.type === 'text' ? (
      <span key={i}>{seg.value}</span>
    ) : (
      <a
        key={i}
        href={seg.url}
        target="_blank"
        rel="noopener noreferrer"
        className="note-link"
      >
        {shortenUrl(seg.url)}
      </a>
    ),
  )
}

// pubkey omitted = "my own profile" (the nav rail avatar), matching the
// original behavior; passed explicitly = viewing someone else's, reached
// via viewProfile() (lib/navigation.ts) from clicking an author elsewhere.
export function ProfileView({ pubkey }: { pubkey?: string } = {}) {
  const activeUser = useActiveUser()
  const viewedPubkey = pubkey ?? activeUser?.pubkey
  const isOwnProfile = !pubkey || pubkey === activeUser?.pubkey
  const viewedUser = useMemo(
    () => (viewedPubkey ? ndk.getUser({ pubkey: viewedPubkey }) : undefined),
    [viewedPubkey],
  )
  const profile = useProfile(viewedPubkey)
  const { events, loading } = useNoteFeed(viewedPubkey ? [viewedPubkey] : undefined)
  const { following, followers } = useFollowCounts(viewedPubkey)
  const {
    isFollowing,
    toggle,
    busy: followBusy,
    loading: followListLoading,
    error: followError,
  } = useFollowing()
  const nip05Verified = useNip05Verified(viewedUser, profile?.nip05)
  // Wallet balance is always the ACTIVE user's own connected NWC wallet —
  // showing it while viewing someone else's profile would misleadingly
  // suggest it's theirs.
  const balanceSats = useWalletBalance()
  const [copied, setCopied] = useState(false)

  const label = profile?.name || profile?.displayName || 'Anonymous'
  const npub = viewedUser?.npub ?? null

  function handleCopyNpub() {
    if (!npub) return
    navigator.clipboard.writeText(npub)
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
            <div className="profile-name-row">
              <span className="profile-name">{label}</span>
              {!isOwnProfile && viewedPubkey && (
                <button
                  type="button"
                  className={`btn btn-sm ${isFollowing(viewedPubkey) ? 'btn-secondary' : 'btn-primary'}`}
                  onClick={() => toggle(viewedPubkey)}
                  disabled={followBusy === viewedPubkey || followListLoading}
                  title={followListLoading ? 'Loading your follow list…' : undefined}
                >
                  {followListLoading
                    ? '…'
                    : followBusy === viewedPubkey
                      ? 'Updating…'
                      : isFollowing(viewedPubkey)
                        ? 'Unfollow'
                        : 'Follow'}
                </button>
              )}
              {followError && !isOwnProfile && (
                <span className="alert-error follow-error">{followError}</span>
              )}
            </div>
            {npub && (
              <button type="button" className="profile-npub" onClick={handleCopyNpub}>
                {copied ? 'Copied!' : `${npub.slice(0, 16)}…`}
              </button>
            )}
            {profile?.about && (
              <p className="profile-about">{renderAbout(profile.about)}</p>
            )}
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
              {isOwnProfile && balanceSats !== null && (
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
            <p className="feed-empty-hint">
              {isOwnProfile
                ? 'Anything you publish will show up here.'
                : "This user hasn't published any notes yet."}
            </p>
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
