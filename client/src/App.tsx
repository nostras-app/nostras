import { useEffect, useRef, useState } from 'react'
import { ndk } from './lib/ndk'
import { hasAnyLocalIdentity, getBootSignerState } from './lib/identities'
import { restoreSignerSession } from './lib/remoteSigner'
import { resolveDeepLinkFromUrl } from './lib/deeplink'
import { setAuthState, useAuthState } from './lib/authState'
import { AuthGate } from './components/AuthGate'
import { UnlockIdentityGate } from './components/UnlockIdentityGate'
import { ComposeView } from './components/ComposeView'
import { ArticleView } from './components/ArticleView'
import { SingleNoteView } from './components/SingleNoteView'
import { AskClaudeCard } from './components/AskClaudeCard'
import { SearchView } from './components/SearchView'
import { ProfileView } from './components/ProfileView'
import { BookmarksView } from './components/BookmarksView'
import { NotificationsView } from './components/NotificationsView'
import { CommunitiesView } from './components/CommunitiesView'
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
import { AccountSettings } from './components/AccountSettings'
import { IdentitySettings } from './components/IdentitySettings'
import { AboutView } from './components/AboutView'
import { NavRail, type View } from './components/NavRail'
import { setActiveView, useNavState } from './lib/navigation'
import './App.css'

type ConnectionState = 'connecting' | 'connected' | 'error'

function App() {
  const [state, setState] = useState<ConnectionState>('connecting')
  const authState = useAuthState()
  const [lockedIdentity, setLockedIdentity] = useState<{ npub: string; label: string } | null>(null)
  // Shared module-level state (lib/navigation.ts), not local useState —
  // lets viewProfile() switch tabs and pick a specific profile pubkey
  // from anywhere (e.g. clicking an author's name deep inside FeedItem)
  // without prop-drilling a callback through every component that
  // renders one.
  const { view: activeView, profilePubkey, article, note, dmTarget, groupTarget } = useNavState()
  const deepLinkResolved = useRef(false)

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
    // account" user — same underlying mechanism, see signer.ts) UNLESS
    // it's NIP-49 encrypted and this tab hasn't unlocked it yet, in
    // which case UnlockIdentityGate renders instead of silently
    // resolving (getBootSignerState's 'locked' case — see identities.ts);
    // else this is a genuinely first-time visitor, so AuthGate renders
    // instead of assuming a signer the way this app used to.
    restoreSignerSession()
      .then((restored) => {
        if (cancelled) return
        if (restored) {
          setAuthState('ready')
        } else if (hasAnyLocalIdentity()) {
          const boot = getBootSignerState()
          if (boot.kind === 'signer') {
            ndk.signer = boot.signer
            setAuthState('ready')
          } else if (boot.kind === 'locked') {
            setLockedIdentity({ npub: boot.npub, label: boot.label })
            setAuthState('locked')
          } else {
            setAuthState('needs-choice')
          }
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

  // Resolves a `?nostr=<naddr1...>` deep link (the client half of the
  // DVM's NIP-89 handler announcement — see deeplink.ts) once the relay
  // pool is connected and a signer/identity is settled, so ndk.fetchEvent
  // has something real to query against. Guarded by a ref rather than an
  // empty dep array alone since this effect's own condition (state/
  // authState both ready) can legitimately become true more than once
  // across renders — the ref is what actually prevents re-resolving on
  // every subsequent render once it's already run.
  useEffect(() => {
    if (deepLinkResolved.current) return
    if (state !== 'connected' || authState !== 'ready') return
    deepLinkResolved.current = true
    resolveDeepLinkFromUrl()
  }, [state, authState])

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
            onClick={() => setActiveView('about')}
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

        {authState === 'needs-choice' && (
          <AuthGate onReady={() => setAuthState('ready')} />
        )}

        {authState === 'locked' && lockedIdentity && (
          <UnlockIdentityGate
            npub={lockedIdentity.npub}
            label={lockedIdentity.label}
            onUnlocked={() => setAuthState('ready')}
            onUseDifferent={() => setAuthState('needs-choice')}
          />
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

            <div className={panelClass('note')}>
              {note && <SingleNoteView event={note} />}
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

            <section className={`card ${panelClass('communities')}`}>
              <CommunitiesView groupTarget={groupTarget} />
            </section>

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
                <span className="settings-section-title">Identities</span>
                <IdentitySettings />
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
              <div className="settings-section">
                <span className="settings-section-title">Account</span>
                <AccountSettings />
              </div>
            </section>

            <section className={`card ${panelClass('about')}`}>
              <AboutView />
            </section>
          </main>
        )}
      </div>
    </div>
  )
}

export default App
