import { useActiveUser } from '../hooks/useActiveUser'
import { useProfile } from '../hooks/useProfile'
import { isSecureImageUrl } from '../lib/parseContent'
import {
  HomeIcon,
  BellIcon,
  MessageSquareIcon,
  SearchIcon,
  UserIcon,
  UsersIcon,
  BookmarkIcon,
  SparklesIcon,
  SettingsIcon,
  InfoIcon,
  PencilIcon,
  StoreIcon,
} from './icons'

export type View =
  | 'home'
  | 'compose'
  | 'ask-claude'
  | 'settings'
  | 'about'
  | 'search'
  | 'profile'
  | 'bookmarks'
  | 'notifications'
  | 'messages'
  | 'communities'
  | 'marketplace'
  | 'article'
  | 'note'
  | 'thread'
  | 'episode'
  | 'listing'

// Caps the displayed number so a genuinely large backlog (e.g. a fresh
// account importing years of history) doesn't blow out the badge's fixed
// circular layout.
function badgeLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}

export function NavRail({
  activeView,
  onSelect,
  unreadNotifications = 0,
  unreadMessages = 0,
}: {
  activeView: View
  onSelect: (view: View) => void
  unreadNotifications?: number
  unreadMessages?: number
}) {
  const activeUser = useActiveUser()
  const profile = useProfile(activeUser?.pubkey)
  const label = profile?.name || profile?.displayName || 'Profile'

  function activeClass(view: View) {
    return activeView === view ? ' nav-rail-btn-active' : ''
  }

  return (
    <nav className="nav-rail" aria-label="Main navigation">
      <button
        type="button"
        className={`nav-rail-btn nav-rail-avatar-btn${activeClass('profile')}`}
        onClick={() => onSelect('profile')}
        title={label}
      >
        {isSecureImageUrl(profile?.picture) ? (
          <img className="nav-rail-avatar" src={profile.picture} alt="" />
        ) : (
          <span className="nav-rail-avatar nav-rail-avatar-fallback">
            <UserIcon />
          </span>
        )}
      </button>

      <button
        type="button"
        className={`nav-rail-btn${activeClass('home')}`}
        onClick={() => onSelect('home')}
        title="Home"
      >
        <HomeIcon />
      </button>
      <button
        type="button"
        className={`nav-rail-btn${activeClass('communities')}`}
        onClick={() => onSelect('communities')}
        title="Communities"
      >
        <UsersIcon />
      </button>
      <button
        type="button"
        className={`nav-rail-btn${activeClass('marketplace')}`}
        onClick={() => onSelect('marketplace')}
        title="Marketplace"
      >
        <StoreIcon />
      </button>
      <button
        type="button"
        className={`nav-rail-btn${activeClass('notifications')}`}
        onClick={() => onSelect('notifications')}
        title={
          unreadNotifications > 0
            ? `Notifications (${unreadNotifications} unread)`
            : 'Notifications'
        }
      >
        <BellIcon />
        {unreadNotifications > 0 && (
          <span className="nav-rail-badge">{badgeLabel(unreadNotifications)}</span>
        )}
      </button>
      <button
        type="button"
        className={`nav-rail-btn${activeClass('messages')}`}
        onClick={() => onSelect('messages')}
        title={unreadMessages > 0 ? `Messages (${unreadMessages} unread)` : 'Messages'}
      >
        <MessageSquareIcon />
        {unreadMessages > 0 && <span className="nav-rail-badge">{badgeLabel(unreadMessages)}</span>}
      </button>
      <button
        type="button"
        className={`nav-rail-btn${activeClass('search')}`}
        onClick={() => onSelect('search')}
        title="Search"
      >
        <SearchIcon />
      </button>
      <button
        type="button"
        className={`nav-rail-btn${activeClass('bookmarks')}`}
        onClick={() => onSelect('bookmarks')}
        title="Bookmarks"
      >
        <BookmarkIcon />
      </button>
      <button
        type="button"
        className={`nav-rail-btn nav-rail-btn-anthropic${activeClass('ask-claude')}`}
        onClick={() => onSelect('ask-claude')}
        title="Ask Claude"
      >
        <SparklesIcon />
      </button>
      <button
        type="button"
        className={`nav-rail-btn${activeClass('settings')}`}
        onClick={() => onSelect('settings')}
        title="Settings"
      >
        <SettingsIcon />
      </button>
      <button
        type="button"
        className={`nav-rail-btn${activeClass('about')}`}
        onClick={() => onSelect('about')}
        title="About NOSTRAS"
      >
        <InfoIcon />
      </button>
      <button
        type="button"
        className={`nav-rail-btn nav-rail-btn-primary${activeClass('compose')}`}
        onClick={() => onSelect('compose')}
        title="Compose"
      >
        <PencilIcon />
      </button>
    </nav>
  )
}
