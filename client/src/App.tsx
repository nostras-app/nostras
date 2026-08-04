import { useEffect, useState } from 'react'
import { ndk } from './lib/ndk'
import { getDevSigner, hasStoredDevSigner } from './lib/signer'
import { restoreSignerSession } from './lib/remoteSigner'
import { AuthGate } from './components/AuthGate'
import { Composer } from './components/Composer'
import { AskClaudeCard } from './components/AskClaudeCard'
import { SearchView } from './components/SearchView'
import { ProfileView } from './components/ProfileView'
import { BookmarksView } from './components/BookmarksView'
import { NotificationsView } from './components/NotificationsView'
import { Feed } from './components/Feed'
import { ProfileEditor } from './components/ProfileEditor'
import { SignerConnect } from './components/SignerConnect'
import { NwcConnect } from './components/NwcConnect'
import { RelaySettings } from './components/RelaySettings'
import { Nip65RelayListEditor } from './components/Nip65RelayListEditor'
import { NavRail, type View } from './components/NavRail'
import { useRelayStatus } from './hooks/useRelayStatus'
import './App.css'

type ConnectionState = 'connecting' | 'connected' | 'error'
type AuthState = 'checking' | 'needs-choice' | 'ready'

function App() {
  const [state, setState] = useState<ConnectionState>('connecting')
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [activeView, setActiveView] = useState<View>('home')
  const { status: relayStatus } = useRelayStatus()

  // Layered on top of `state` rather than replacing it: `state` gates
  // whether the app shell renders at all (set once, from the initial
  // connect) and shouldn't flip back just because the relay hiccups later
  // — that would hide content that's still perfectly usable. This only
  // adds an honest "reconnecting" label when a relay drop happens after
  // we were already up, instead of the pill silently freezing on
  // "connected" while a subscription is actually stale (see
  // lib/relayStatus.ts).
  const displayState =
    state === 'connected' && relayStatus === 'disconnected' ? 'reconnecting' : state

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
          <div className="brand">
            <img src="/favicon.svg" alt="" className="brand-icon" />
            <h1>NOSTRAS</h1>
          </div>
          <div className="header-right">
            <span className="status-pill" data-state={displayState}>
              <span className="status-dot" />
              {displayState}
            </span>
          </div>
        </header>

        {authState === 'needs-choice' && (
          <AuthGate onReady={() => setAuthState('ready')} />
        )}

        {state === 'connected' && authState === 'ready' && (
          <main className="app-main">
            <div className={panelClass('home')}>
              <Feed />
            </div>

            <section className={`card ${panelClass('compose')}`}>
              <Composer />
            </section>

            <section className={`card ${panelClass('ask-claude')}`}>
              <AskClaudeCard />
            </section>

            <div className={panelClass('search')}>
              <SearchView />
            </div>

            <div className={panelClass('profile')}>
              <ProfileView />
            </div>

            <div className={panelClass('bookmarks')}>
              <BookmarksView active={activeView === 'bookmarks'} />
            </div>

            <div className={panelClass('notifications')}>
              <NotificationsView />
            </div>

            <section className={`card settings-panel ${panelClass('settings')}`}>
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
            </section>
          </main>
        )}
      </div>
    </div>
  )
}

export default App
