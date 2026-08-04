import {
  HomeIcon,
  BellIcon,
  MessageSquareIcon,
  SearchIcon,
  UserIcon,
  BookmarkIcon,
  SparkleIcon,
  SettingsIcon,
  PencilIcon,
} from './icons'

export type View = 'home' | 'compose' | 'ask-claude' | 'settings' | 'search'

export function NavRail({
  activeView,
  onSelect,
}: {
  activeView: View
  onSelect: (view: View) => void
}) {
  function activeClass(view: View) {
    return activeView === view ? ' nav-rail-btn-active' : ''
  }

  return (
    <nav className="nav-rail" aria-label="Main navigation">
      <button
        type="button"
        className={`nav-rail-btn${activeClass('home')}`}
        onClick={() => onSelect('home')}
        title="Home"
      >
        <HomeIcon />
      </button>
      <button type="button" className="nav-rail-btn" disabled title="Notifications (coming soon)">
        <BellIcon />
      </button>
      <button type="button" className="nav-rail-btn" disabled title="Messages (coming soon)">
        <MessageSquareIcon />
      </button>
      <button
        type="button"
        className={`nav-rail-btn${activeClass('search')}`}
        onClick={() => onSelect('search')}
        title="Search"
      >
        <SearchIcon />
      </button>
      <button type="button" className="nav-rail-btn" disabled title="Profile (coming soon)">
        <UserIcon />
      </button>
      <button type="button" className="nav-rail-btn" disabled title="Bookmarks (coming soon)">
        <BookmarkIcon />
      </button>
      <button
        type="button"
        className={`nav-rail-btn nav-rail-btn-anthropic${activeClass('ask-claude')}`}
        onClick={() => onSelect('ask-claude')}
        title="Ask Claude"
      >
        <SparkleIcon />
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
        className={`nav-rail-btn nav-rail-btn-primary${activeClass('compose')}`}
        onClick={() => onSelect('compose')}
        title="Compose"
      >
        <PencilIcon />
      </button>
    </nav>
  )
}
