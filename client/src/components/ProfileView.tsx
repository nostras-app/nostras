import { useMemo, useState } from 'react'
import { ndk } from '../lib/ndk'
import { useActiveUser } from '../hooks/useActiveUser'
import { useProfile } from '../hooks/useProfile'
import { useNoteFeed } from '../hooks/useNoteFeed'
import { useFollowCounts } from '../hooks/useFollowCounts'
import { useFollowing } from '../hooks/useFollowing'
import { useFollowSets, useFollowSetsOf } from '../hooks/useFollowSets'
import { ProfileListsModal } from './ProfileListsModal'
import { ListPickerModal } from './ListPickerModal'
import { useNip05Verified } from '../hooks/useNip05Verified'
import { useWalletBalance } from '../hooks/useWalletBalance'
import { useUserStatus } from '../hooks/useUserStatus'
import { useExternalIdentities } from '../hooks/useExternalIdentities'
import { EXTERNAL_IDENTITY_PLATFORMS, externalIdentityProfileUrl } from '../lib/externalIdentities'
import { FeedItem, FeedSkeleton } from './Feed'
import { FollowListModal } from './FollowListModal'
import { ProfileBadgeRow } from './ProfileBadgeRow'
import { UserIcon, CheckCircleIcon, ZapCircleIcon, StarIcon } from './icons'
import { parseContentSegments, shortenUrl, isSecureImageUrl } from '../lib/parseContent'
import { MentionLink } from './MentionLink'

// Same URL-detection parseContentSegments already uses for note content —
// reused here just for linkification (a bio doesn't get inline media
// embeds like a note does, so every non-text, non-mention segment renders
// as a plain clickable link regardless of its sniffed type).
function renderAbout(about: string) {
  return parseContentSegments(about).map((seg, i) => {
    if (seg.type === 'text') return <span key={i}>{seg.value}</span>
    if (seg.type === 'mention') return <MentionLink key={i} decoded={seg.decoded} />
    return (
      <a
        key={i}
        href={seg.url}
        target="_blank"
        rel="noopener noreferrer"
        className="note-link"
      >
        {shortenUrl(seg.url)}
      </a>
    )
  })
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
  const { events, loading, loadOlder, loadingOlder, loadOlderError, hasMore } = useNoteFeed(
    viewedPubkey ? [viewedPubkey] : undefined,
  )
  const { following, followers, followingPubkeys, followerPubkeys } = useFollowCounts(viewedPubkey)
  const [listModal, setListModal] = useState<'following' | 'followers' | null>(null)
  const {
    isFollowing,
    toggle,
    busy: followBusy,
    loading: followListLoading,
    error: followError,
  } = useFollowing()
  const nip05Verified = useNip05Verified(viewedUser, profile?.nip05)
  const status = useUserStatus(viewedPubkey)
  const externalIdentities = useExternalIdentities(viewedPubkey)
  // Wallet balance is always the ACTIVE user's own connected NWC wallet —
  // showing it while viewing someone else's profile would misleadingly
  // suggest it's theirs.
  const balanceSats = useWalletBalance()
  const [copied, setCopied] = useState(false)
  const [listPickerOpen, setListPickerOpen] = useState(false)
  const [profileListsOpen, setProfileListsOpen] = useState(false)
  const { sets: viewedSets } = useFollowSetsOf(viewedPubkey)
  const { listsContaining } = useFollowSets()
  const onAnyList = viewedPubkey ? listsContaining(viewedPubkey).length > 0 : false

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
      {listPickerOpen && viewedPubkey && (
        <ListPickerModal pubkey={viewedPubkey} name={label} onClose={() => setListPickerOpen(false)} />
      )}
      <div className={`profile-header${isSecureImageUrl(profile?.banner) ? ' has-banner' : ''}`}>
        {isSecureImageUrl(profile?.banner) && (
          <img className="profile-banner" src={profile.banner} alt="" />
        )}
        <div className="profile-header-body">
          {isSecureImageUrl(profile?.picture) ? (
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
              {!isOwnProfile && viewedPubkey && (
                <button
                  type="button"
                  className={`btn btn-sm btn-secondary profile-lists-btn${onAnyList ? ' profile-lists-btn-active' : ''}`}
                  onClick={() => setListPickerOpen(true)}
                  title="Add to lists"
                  aria-label="Add to lists"
                >
                  <StarIcon filled={onAnyList} />
                </button>
              )}
              {followError && !isOwnProfile && (
                <span className="alert-error follow-error">{followError}</span>
              )}
            </div>
            {status && (
              <p className="profile-status">
                {status.url ? (
                  <a href={status.url} target="_blank" rel="noopener noreferrer" className="note-link">
                    {status.content}
                  </a>
                ) : (
                  status.content
                )}
              </p>
            )}
            {npub && (
              <button type="button" className="profile-npub" onClick={handleCopyNpub}>
                {copied ? 'Copied!' : `${npub.slice(0, 16)}…`}
              </button>
            )}
            {profile?.about && (
              <p className="profile-about">{renderAbout(profile.about)}</p>
            )}
            <div className="profile-stats">
              <button
                type="button"
                className="profile-stat-btn"
                onClick={() => setListModal('following')}
                disabled={following === null || following === 0}
                title="Based on what's visible across connected relays, not the whole network"
              >
                <strong>{following ?? '—'}</strong> Following
              </button>
              <button
                type="button"
                className="profile-stat-btn"
                onClick={() => setListModal('followers')}
                disabled={followers === 0}
                title="Based on what's visible across connected relays, not the whole network"
              >
                <strong>{followers ?? '—'}</strong> Followers
              </button>
              {viewedSets.length > 0 && (
                <button
                  type="button"
                  className="profile-stat-btn"
                  onClick={() => setProfileListsOpen(true)}
                  title="Public NIP-51 lists (follow sets)"
                >
                  <strong>{viewedSets.length}</strong> {viewedSets.length === 1 ? 'List' : 'Lists'}
                </button>
              )}
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
            {externalIdentities.length > 0 && (
              <div className="profile-external-identities" title="Claimed by this profile, not independently verified">
                {externalIdentities.map((id) => {
                  const url = externalIdentityProfileUrl(id.platform, id.identity)
                  const label = EXTERNAL_IDENTITY_PLATFORMS.find((p) => p.id === id.platform)?.label ?? id.platform
                  return url ? (
                    <a
                      key={`${id.platform}:${id.identity}`}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="profile-external-identity"
                    >
                      {label}: {id.identity}
                    </a>
                  ) : (
                    <span key={`${id.platform}:${id.identity}`} className="profile-external-identity">
                      {label}: {id.identity}
                    </span>
                  )
                })}
              </div>
            )}
            <ProfileBadgeRow pubkey={viewedPubkey} />
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

        {events.length > 0 && hasMore && (
          <div className="feed-load-more">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={loadOlder}
              disabled={loadingOlder}
            >
              {loadingOlder ? 'Loading…' : 'Load older'}
            </button>
            {loadOlderError && <p className="alert-error">{loadOlderError}</p>}
          </div>
        )}

        {events.length > 0 && !hasMore && (
          <p className="feed-load-more-end">That's everything.</p>
        )}
      </div>

      {profileListsOpen && (
        <ProfileListsModal
          name={label}
          sets={viewedSets}
          isOwnProfile={isOwnProfile}
          onClose={() => setProfileListsOpen(false)}
        />
      )}

      {listModal && (
        <FollowListModal
          title={listModal === 'following' ? 'Following' : 'Followers'}
          pubkeys={listModal === 'following' ? followingPubkeys : followerPubkeys}
          onClose={() => setListModal(null)}
        />
      )}
    </div>
  )
}
