import { useState } from 'react'
import { loadArkMnemonic } from '../lib/arkWallet'
import { getSavedNwcUri } from '../lib/nwc'
import { setActiveView } from '../lib/navigation'
import { useActiveUser } from '../hooks/useActiveUser'
import { NwcWalletPanel } from './NwcWalletPanel'
import { WalletIcon } from './icons'

type WalletTab = 'nwc' | 'ark'

// A dedicated Wallet view, distinct from Settings' own NWC/Ark
// connection UI — this is where you actually *use* a connected wallet
// (balance, history, invoices, payments), not where you connect one.
// Deliberately reads getSavedNwcUri()/loadArkMnemonic() inline on every
// render rather than into useState — both are plain, cheap,
// synchronous localStorage reads already scoped to the active identity
// internally, and calling useActiveUser() below is what makes this
// component re-render (and so re-read them) the moment the user
// switches identity in Settings, matching NwcConnect.tsx's/
// ArkWalletSettings.tsx's own established pattern for the same check.
export function WalletView() {
  useActiveUser()
  const [tab, setTab] = useState<WalletTab>('nwc')
  const nwcConfigured = !!getSavedNwcUri()
  const arkConfigured = !!loadArkMnemonic()

  if (!nwcConfigured && !arkConfigured) {
    return (
      <div className="stack wallet-empty-state">
        <span className="wallet-empty-icon">
          <WalletIcon />
        </span>
        <h2>Own Your Money</h2>
        <p className="field-hint">
          NOSTRAS never holds your keys or your funds, ever — a wallet only
          ever lives wherever <strong>you</strong> actually run it. Connect a
          real Lightning wallet over NWC, or create an experimental Ark
          (Signet test network) wallet, right from Settings.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setActiveView('settings')}>
          Go to Settings
        </button>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="feed-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'nwc'}
          className={`feed-tab${tab === 'nwc' ? ' feed-tab-active' : ''}`}
          onClick={() => setTab('nwc')}
        >
          NWC Wallet
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'ark'}
          className={`feed-tab${tab === 'ark' ? ' feed-tab-active' : ''}`}
          onClick={() => setTab('ark')}
        >
          Ark Wallet
        </button>
      </div>
      {tab === 'nwc' &&
        (nwcConfigured ? (
          <NwcWalletPanel />
        ) : (
          <div className="stack">
            <p className="field-hint">
              No NWC wallet connected on this identity yet.{' '}
              <button
                type="button"
                className="mention-link"
                onClick={() => setActiveView('settings')}
              >
                Connect one in Settings
              </button>
              .
            </p>
          </div>
        ))}
      {tab === 'ark' &&
        (arkConfigured ? (
          <div className="stack">
            <p className="ark-wallet-experimental-banner">
              EXPERIMENTAL — Signet test network only. Not real money, ever.
            </p>
            <p className="field-hint">
              The Ark wallet's own full tools (balance, boarding,
              offboarding, Lightning, VTXO refresh, emergency exit) still
              live in Settings for now — this tab is a placeholder,
              scoped for a later pass. NOSTRAS will release a real
              mainnet Ark wallet once our own testing protocols —
              including a real emergency exit and claim, proven end to
              end — are actually finished, not before.
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveView('settings')}>
              Open in Settings
            </button>
          </div>
        ) : (
          <div className="stack">
            <p className="field-hint">
              No Ark wallet created on this identity yet.{' '}
              <button
                type="button"
                className="mention-link"
                onClick={() => setActiveView('settings')}
              >
                Create one in Settings
              </button>
              .
            </p>
          </div>
        ))}
    </div>
  )
}
