import { useEffect, useRef, useState } from 'react'
import { ndk } from './lib/ndk'
import { hasAnyLocalIdentity, getBootSignerState } from './lib/identities'
import { restoreSignerSession } from './lib/remoteSigner'
import { resolveDeepLinkFromUrl } from './lib/deeplink'
import { openExistingArkWallet } from './lib/arkWallet'
import { fetchAppPreferences, applyFetchedPreferences, publishCurrentPreferences } from './lib/appData'
import {
  loadLastSeenNotifications,
  saveLastSeenNotifications,
  loadSeenMessageWrapIds,
  saveSeenMessageWrapIds,
} from './lib/unreadState'
import { useNotifications } from './hooks/useNotifications'
import { useDirectMessages } from './hooks/useDirectMessages'
import { setAuthState, useAuthState } from './lib/authState'
import { AuthGate } from './components/AuthGate'
import { UnlockIdentityGate } from './components/UnlockIdentityGate'
import { ComposeView } from './components/ComposeView'
import { ArticleView } from './components/ArticleView'
import { SingleNoteView } from './components/SingleNoteView'
import { ThreadView } from './components/ThreadView'
import { PodcastEpisodeView } from './components/PodcastEpisodeView'
import { ListingView } from './components/ListingView'
import { MarketplaceView } from './components/MarketplaceView'
import { JobOfferView } from './components/JobOfferView'
import { JobBoardView } from './components/JobBoardView'
import { WalletView } from './components/WalletView'
import { AskClaudeCard } from './components/AskClaudeCard'
import { SearchView } from './components/SearchView'
import { ProfileView } from './components/ProfileView'
import { BookmarksView } from './components/BookmarksView'
import { NotificationsView } from './components/NotificationsView'
import { CommunitiesView } from './components/CommunitiesView'
import { BoardsView } from './components/BoardsView'
import { MessagesView } from './components/MessagesView'
import { Feed } from './components/Feed'
import { ProfileEditor } from './components/ProfileEditor'
import { PodcastShowSettings } from './components/PodcastShowSettings'
import { LinkedAccountsSettings } from './components/LinkedAccountsSettings'
import { BadgesSettings } from './components/BadgesSettings'
import { MuteListSettings } from './components/MuteListSettings'
import { FollowSetsSettings } from './components/FollowSetsSettings'
import { SignerConnect } from './components/SignerConnect'
import { NwcConnect } from './components/NwcConnect'
import { ArkWalletSettings } from './components/ArkWalletSettings'
import { RelaySettings } from './components/RelaySettings'
import { Nip65RelayListEditor } from './components/Nip65RelayListEditor'
import { DmRelayListEditor } from './components/DmRelayListEditor'
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
  const {
    view: activeView,
    profilePubkey,
    article,
    note,
    thread,
    episode,
    listing,
    job,
    dmTarget,
    groupTarget,
    board,
  } = useNavState()
  const deepLinkResolved = useRef(false)
  const appPreferencesSynced = useRef(false)

  // Owned here, not inside NotificationsView/MessagesView, specifically
  // so the nav rail's unread badges can read the exact same live
  // events/conversations/wrapIds those views render, without opening a
  // second duplicate subscription just to compute a count (this
  // codebase has hit that exact duplicate-subscription bug class more
  // than once already). Passed down as props to both views below.
  const { events: notificationEvents, loading: notificationsLoading } = useNotifications()
  const {
    conversations,
    loading: messagesLoading,
    decrypting,
    wrapIds: messageWrapIds,
  } = useDirectMessages(activeView === 'messages')

  // "Seen" markers backing the badges — initialized once from
  // localStorage (possibly already advanced by an earlier NIP-78 sync
  // from another device, restored below); read via refs inside the
  // marking effects so those effects don't need these in their own
  // dependency arrays (the same activeRef pattern useDirectMessages.ts
  // already uses for its own `active` flag). Notifications track a
  // plain timestamp (a real, honest created_at exists to compare
  // against); DMs track a *set of wrap ids* instead — NIP-59
  // deliberately randomizes a gift wrap's own outer created_at, so
  // there is no real timestamp available to compare against here (see
  // lib/unreadState.ts's own comment). Using `conversations` for the
  // DM badge would also be wrong on its own: decryption is deliberately
  // lazy (only runs once Messages is the active view, a real fix for
  // NIP-46 bunker signer cost — see useDirectMessages.ts), so an unread
  // wrap sitting undecrypted would never show up in `conversations` at
  // all — confirmed live while building this, not theoretical.
  const [lastSeenNotificationsAt, setLastSeenNotificationsAt] = useState(loadLastSeenNotifications)
  const [seenMessageWrapIds, setSeenMessageWrapIds] = useState(
    () => new Set(loadSeenMessageWrapIds()),
  )
  const lastSeenNotificationsRef = useRef(lastSeenNotificationsAt)
  lastSeenNotificationsRef.current = lastSeenNotificationsAt
  const seenMessageWrapIdsRef = useRef(seenMessageWrapIds)
  seenMessageWrapIdsRef.current = seenMessageWrapIds
  const notificationsSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messagesSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Marks Notifications "seen" up through whatever's currently newest
  // (events is sorted newest-first) the whole time this view stays
  // active — not just once on arrival — so a note that arrives while
  // you're already looking at the tab is immediately "seen" too, rather
  // than flashing unread the instant you navigate away. The actual NIP-78
  // publish is debounced (not fired on every single new event) so a
  // burst of live notifications doesn't spam the relay with republishes.
  useEffect(() => {
    if (activeView !== 'notifications' || notificationEvents.length === 0) return
    const latest = notificationEvents[0].created_at ?? Math.floor(Date.now() / 1000)
    if (latest <= lastSeenNotificationsRef.current) return
    setLastSeenNotificationsAt(latest)
    saveLastSeenNotifications(latest)
    if (notificationsSyncTimer.current) clearTimeout(notificationsSyncTimer.current)
    notificationsSyncTimer.current = setTimeout(() => {
      publishCurrentPreferences().catch(() => {})
    }, 3000)
  }, [activeView, notificationEvents])

  // Same "seen" semantics for Messages (only while the view is actually
  // open), just diffing wrap ids instead of a timestamp — see the
  // comment above.
  useEffect(() => {
    if (activeView !== 'messages' || messageWrapIds.length === 0) return
    const hasNew = messageWrapIds.some((id) => !seenMessageWrapIdsRef.current.has(id))
    if (!hasNew) return
    const merged = new Set([...seenMessageWrapIdsRef.current, ...messageWrapIds])
    setSeenMessageWrapIds(merged)
    saveSeenMessageWrapIds(Array.from(merged))
    if (messagesSyncTimer.current) clearTimeout(messagesSyncTimer.current)
    messagesSyncTimer.current = setTimeout(() => {
      publishCurrentPreferences().catch(() => {})
    }, 3000)
  }, [activeView, messageWrapIds])

  // While a view is the one actually on screen, nothing in it should
  // read as "unread" regardless of how fresh the marking effects above
  // have managed to catch up yet.
  const unreadNotifications =
    activeView === 'notifications'
      ? 0
      : notificationEvents.filter((e) => (e.created_at ?? 0) > lastSeenNotificationsAt).length
  const unreadMessages =
    activeView === 'messages'
      ? 0
      : messageWrapIds.filter((id) => !seenMessageWrapIds.has(id)).length

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

  // Experimental Ark (Signet) wallet — silently reopens an existing local
  // wallet if one was created in an earlier session (see arkWallet.ts).
  // Independent of the Nostr signer/relay-pool state above: it's a
  // separate identity with its own separate connection to the Ark
  // server, not gated on anything else here. openExistingArkWallet()
  // itself no-ops if there's no stored mnemonic or a wallet is already
  // open, so this is safe to call on every mount (including React
  // StrictMode's deliberate double-invoke) without a ref guard.
  useEffect(() => {
    openExistingArkWallet()
  }, [])

  // NIP-78: pulls this identity's synced app preferences (feed mode,
  // custom relay list — see lib/appData.ts for why only those two) once
  // per boot, same gating as the deep-link effect above (signer/relay
  // pool both settled). Deliberately does not try to make a synced
  // change take effect on *this* load — Feed's own feed-mode state and
  // the relay pool's live connections are both already initialized by
  // the time this resolves, same as a locally-added custom relay
  // already requires a reload to actually connect. This only updates
  // storage so the *next* load picks it up, consistent with that
  // existing behavior rather than adding a new loading gate just for
  // this.
  useEffect(() => {
    if (appPreferencesSynced.current) return
    if (state !== 'connected' || authState !== 'ready') return
    const pubkey = ndk.activeUser?.pubkey
    if (!pubkey) return
    appPreferencesSynced.current = true
    fetchAppPreferences(pubkey).then((prefs) => {
      if (prefs) applyFetchedPreferences(prefs)
    })
  }, [state, authState])

  function panelClass(view: View) {
    return `view-panel${activeView === view ? ' view-panel-active' : ''}`
  }

  return (
    <div className="app">
      {state === 'connected' && authState === 'ready' && (
        <NavRail
          activeView={activeView}
          onSelect={setActiveView}
          unreadNotifications={unreadNotifications}
          unreadMessages={unreadMessages}
        />
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

            <div className={panelClass('thread')}>
              {thread && <ThreadView event={thread} />}
            </div>

            <div className={panelClass('episode')}>
              {episode && <PodcastEpisodeView event={episode} />}
            </div>

            <div className={panelClass('listing')}>
              {listing && <ListingView event={listing} />}
            </div>

            <div className={panelClass('job')}>
              {job && <JobOfferView event={job} />}
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

            <section className={`card ${panelClass('boards')}`}>
              <BoardsView boardTarget={board} />
            </section>

            <section className={`card ${panelClass('marketplace')}`}>
              <MarketplaceView />
            </section>

            <section className={`card ${panelClass('jobs')}`}>
              <JobBoardView />
            </section>

            <section className={`card ${panelClass('wallet')}`}>
              <WalletView />
            </section>

            <div className={panelClass('notifications')}>
              <NotificationsView events={notificationEvents} loading={notificationsLoading} />
            </div>

            <div className={panelClass('messages')}>
              <MessagesView
                initialPeer={dmTarget}
                conversations={conversations}
                loading={messagesLoading}
                decrypting={decrypting}
              />
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
                <span className="settings-section-title">NWC Wallet</span>
                <NwcConnect />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Ark Wallet</span>
                <ArkWalletSettings />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Profile</span>
                <ProfileEditor />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Podcast Show</span>
                <PodcastShowSettings />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Linked Accounts</span>
                <LinkedAccountsSettings />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Badges</span>
                <BadgesSettings />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Lists</span>
                <FollowSetsSettings />
              </div>
              <div className="settings-section">
                <span className="settings-section-title">Muted Accounts</span>
                <MuteListSettings />
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
                <span className="settings-section-title">DM Relays (NIP-17)</span>
                <DmRelayListEditor />
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
