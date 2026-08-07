import { useEffect, useState } from 'react'
import { ndk } from './lib/ndk'
import { getDevSigner, hasStoredDevSigner } from './lib/signer'
import { restoreSignerSession } from './lib/remoteSigner'
import { AuthGate } from './components/AuthGate'
import { ComposeView } from './components/ComposeView'
import { ArticleView } from './components/ArticleView'
import { AskClaudeCard } from './components/AskClaudeCard'
import { SearchView } from './components/SearchView'
import { ProfileView } from './components/ProfileView'
import { BookmarksView } from './components/BookmarksView'
import { NotificationsView } from './components/NotificationsView'
import { MessagesView } from './components/MessagesView'
import { Feed } from './components/Feed'
import { ProfileEditor } from './components/ProfileEditor'
import { SignerConnect } from './components/SignerConnect'
import { NwcConnect } from './components/NwcConnect'
import { RelaySettings } from './components/RelaySettings'
import { Nip65RelayListEditor } from './components/Nip65RelayListEditor'
import { PushNotificationSettings } from './components/PushNotificationSettings'
import { InstallPwaSettings } from './components/InstallPwaSettings'
import { AboutSettings } from './components/AboutSettings'
import { AboutModal } from './components/AboutModal'
import { NavRail, type View } from './components/NavRail'
import { setActiveView, useNavState } from './lib/navigation'
import './App.css'

type ConnectionState = 'connecting' | 'connected' | 'error'
type AuthState = 'checking' | 'needs-choice' | 'ready'

function App() {
  const [state, setState] = useState<ConnectionState>('connecting')
  const [authState, setAuthState] = useState<AuthState>('checking')
  // Shared module-level state (lib/navigation.ts), not local useState —
  // lets viewProfile() switch tabs and pick a specific profile pubkey
  // from anywhere (e.g. clicking an author's name deep inside FeedItem)
  // without prop-drilling a callback through every component that
  // renders one.
  const { view: activeView, profilePubkey, article, dmTarget } = useNavState()
  const [aboutOpen, setAboutOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    // NDK.connect() waits for every relay in the set to connect and, with
    // no timeout, hangs forever if even one never does (e.g. an unreachable
    // public relay) — always pass a timeout so this resolves regardless.
    ndk
      .connect(5000)
      .then(() => {
        if (!cancelled) setState('connected')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    // Resolution order: a previously-connected NIP-46/NIP-07 signer wins
    // (returning user with a real identity); else a previously-created
    // local key restores silently (returning "anonymous"/"created
    // account" user — same underlying mechanism, see signer.ts); else
    // this is a genuinely first-time visitor, so AuthGate renders instead
    // of assuming a signer the way this app used to.
    restoreSignerSession()
      .then((restored) => {
        if (cancelled) return
        if (restored) {
          setAuthState('ready')
        } else if (hasStoredDevSigner()) {
          ndk.signer = getDevSigner()
          setAuthState('ready')
        } else {
          setAuthState('needs-choice')
        }
      })
      .catch(() => {
        if (!cancelled) setAuthState('needs-choice')
      })

    return () => {
      cancelled = true
    }
  }, [])

  function panelClass(view: View) {
    return `view-panel${activeView === view ? ' view-panel-active' : ''}`
  }

  return (
    <div className="app">
      {state === 'connected' && authState === 'ready' && (
        <NavRail activeView={activeView} onSelect={setActiveView} />
      )}

      <div className="app-content">
        <header className="app-header">
          <div className="header-spacer" aria-hidden="true" />
          <button
            type="button"
            className="brand brand-btn"
            onClick={() => setAboutOpen(true)}
            aria-haspopup="dialog"
          >
            <img src="/favicon.svg" alt="" className="brand-icon" />
            <h1>NOSTRAS</h1>
          </button>
          {/* Empty on purpose — mirrors header-spacer on the left so the
              brand block stays centered via the 3-column grid. The
              connection-status pill that used to live here was removed:
              redundant with Settings > Relays, and overlapped the brand
              on narrow viewports. */}
          <div className="header-right" aria-hidden="true" />
        </header>

        {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}

        {authState === 'needs-choice' && (
          <AuthGate onReady={() => setAuthState('ready')} />
        )}

        {state === 'connected' && authState === 'ready' && (
          <main className="app-main">
            <div className={panelClass('home')}>
              <Feed />
            </div>

            <section className={`card ${panelClass('compose')}`}>
              <ComposeView />
            </section>

            <div className={panelClass('article')}>
              {article && <ArticleView event={article} />}
            </div>

            <section className={`card ${panelClass('ask-claude')}`}>
              <AskClaudeCard />
            </section>

            <div className={panelClass('search')}>
              <SearchView />
            </div>

            <div className={panelClass('profile')}>
              <ProfileView pubkey={profilePubkey ?? undefined} />
            </div>

            <div className={panelClass('bookmarks')}>
              <BookmarksView active={activeView === 'bookmarks'} />
            </div>

            <div className={panelClass('notifications')}>
              <NotificationsView />
            </div>

            <div className={panelClass('messages')}>
              <MessagesView initialPeer={dmTarget} />
            </div>

            <section className={`card settings-panel ${panelClass('settings')}`}>
              <div className="settings-section">
                <span className="settings-section-title">Install App</span>
                <InstallPwaSettings />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Notifications</span>
                <PushNotificationSettings />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Signer</span>
                <SignerConnect />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Wallet</span>
                <NwcConnect />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Profile</span>
                <ProfileEditor />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Relays</span>
                <RelaySettings />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Your Relay List (NIP-65)</span>
                <Nip65RelayListEditor />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">About</span>
                <AboutSettings />
              </div>
            </section>
          </main>
        )}
      </div>
    </div>
  )
}

export default App
