import { useEffect, useState } from 'react'
import { ndk } from './lib/ndk'
import { Composer } from './components/Composer'
import { Feed } from './components/Feed'
import { ProfileEditor } from './components/ProfileEditor'
import { SignerConnect } from './components/SignerConnect'
import { NwcConnect } from './components/NwcConnect'
import { SettingsIcon } from './components/icons'
import './App.css'

type ConnectionState = 'connecting' | 'connected' | 'error'

function App() {
  const [state, setState] = useState<ConnectionState>('connecting')
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-spacer" aria-hidden="true" />
        <div className="brand">
          <img src="/favicon.svg" alt="" className="brand-icon" />
          <h1>NOSTRAS</h1>
        </div>
        <div className="header-right">
          <span className="status-pill" data-state={state}>
            <span className="status-dot" />
            {state}
          </span>
          {state === 'connected' && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Account settings"
              title="Account settings"
            >
              <SettingsIcon />
            </button>
          )}
        </div>
      </header>

      {state === 'connected' && (
        <main className="app-main">
          {settingsOpen && (
            <section className="card settings-panel">
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
            </section>
          )}

          <section className="card">
            <Composer />
          </section>

          <Feed />
        </main>
      )}
    </div>
  )
}

export default App
