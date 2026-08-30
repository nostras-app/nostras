import { useSyncExternalStore } from 'react'
import type { Wallet as ArkWalletHandle } from '@secondts/bark/web'
import { ndk } from './ndk'

// Experimental Ark (https://ark-protocol.org) wallet support — built
// against Second's "Bark" SDK (@secondts/bark), the only real browser-
// native, WASM-based Ark client SDK found during research (2026-08-30,
// see nostr-client-node-strategy.md's "Exploratory: growth strategy
// options" section for the full comparison against Arkade's "Intents"
// SDK, which was ruled out for being mainnet-only with no test network
// at all — the opposite of what this feature needs).
//
// Deliberately, permanently scoped to Signet — a real Bitcoin test
// network with zero real monetary value, not a placeholder step toward
// mainnet support baked into this same code path. If this ever
// graduates toward real money, that's a new, deliberate decision with
// its own real custody/safety review, not a config flag flipped here.
//
// A genuinely separate mnemonic from the Nostr identity, not derived
// from nsec — matching the same conclusion the earlier Lightning/VLS
// research already reached (see the "self-custodial Lightning wallet
// infrastructure" section): a dedicated seed with its own real
// backup/export UX, not a free ride off existing identity material.
//
// Scoped per Nostr identity (2026-08-30, real bug fix): originally one
// global mnemonic/wallet regardless of which identity was active —
// switching identities in Settings left the previous identity's wallet
// showing, exactly like a signer that didn't actually swap. Every
// storage key (mnemonic, IndexedDB name) now includes the active
// identity's pubkey, and every public function here stays no-arg,
// resolving `ndk.activeUser?.pubkey` internally — same "ndk.activeUser
// is the single reactive source of truth" rule useActiveUser.ts already
// established, not identities.ts's local-only getActiveIdentityNpub()
// (which wouldn't know about a NIP-46/NIP-07 active user at all).
const ARK_MNEMONIC_KEY_PREFIX = 'nostras:ark-wallet-mnemonic'
const ARK_INDEXED_DB_NAME_PREFIX = 'nostras-ark-signet-wallet'
const ARK_SERVER_ADDRESS = 'https://ark.signet.2nd.dev'
const ARK_ESPLORA_ADDRESS = 'https://esplora.signet.2nd.dev'

function scopedMnemonicKey(pubkey: string): string {
  return `${ARK_MNEMONIC_KEY_PREFIX}:${pubkey}`
}

function scopedIndexedDbName(pubkey: string): string {
  return `${ARK_INDEXED_DB_NAME_PREFIX}-${pubkey}`
}

// Runs at most once per page load, the first time any identity's
// mnemonic is looked up — migrates the old single global wallet forward
// to whichever identity happens to be active at that moment (the same
// best-effort, first-one-wins heuristic identities.ts's own
// migrateLegacyIfNeeded() already uses for the pre-multi-identity nsec
// key), rather than silently orphaning a real, already-created Signet
// wallet. Deliberately leaves the legacy IndexedDB database (also
// unscoped) untouched — the reopened wallet gets a fresh, correctly
// -scoped one and resyncs its real state from the Ark server, and the
// old local cache is harmless leftover data with zero real value.
let arkMigrated = false
function migrateLegacyArkMnemonicIfNeeded(pubkey: string) {
  if (arkMigrated) return
  arkMigrated = true
  if (localStorage.getItem(scopedMnemonicKey(pubkey))) return
  const legacy = localStorage.getItem(ARK_MNEMONIC_KEY_PREFIX)
  if (!legacy) return
  localStorage.setItem(scopedMnemonicKey(pubkey), legacy)
  localStorage.removeItem(ARK_MNEMONIC_KEY_PREFIX)
}

export function loadArkMnemonic(): string | null {
  const pubkey = ndk.activeUser?.pubkey
  if (!pubkey) return null
  migrateLegacyArkMnemonicIfNeeded(pubkey)
  return localStorage.getItem(scopedMnemonicKey(pubkey))
}

function saveArkMnemonic(pubkey: string, mnemonic: string): void {
  localStorage.setItem(scopedMnemonicKey(pubkey), mnemonic)
}

type ArkWalletState = {
  status: 'none' | 'opening' | 'ready' | 'error'
  address: string | null
  balanceSats: number | null
  syncing: boolean
  error: string | null
}

let state: ArkWalletState = {
  status: 'none',
  address: null,
  balanceSats: null,
  syncing: false,
  error: null,
}

// Type-only import above (erased at build time, never triggers the
// package's own runtime WASM-loading code) so this can be properly
// typed without eagerly importing the module outside loadBark()'s own
// dynamic import — the whole point of loading it dynamically there.
let walletInstance: ArkWalletHandle | null = null

// Which identity's wallet walletInstance/state currently reflect — lets
// switchToIdentity() tell "nothing to do, already on this identity"
// apart from a real switch, and lets a stale async openWallet() call
// notice it's no longer relevant (see the guard inside openWallet).
let currentWalletPubkey: string | null = null

const listeners = new Set<() => void>()

function setState(patch: Partial<ArkWalletState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The package's default ("bundler" target) import fails in this
// project's real Vite dev server — Vite's esbuild-based dependency
// pre-bundler doesn't handle wasm-bindgen's "bundler" target's implicit
// WASM instantiation the way webpack does (confirmed live during the
// 2026-08-30 spike: a real `Cannot read properties of undefined
// (reading '__wbindgen_add_to_stack_pointer')` failure). The "web"
// target with an explicit `init()` call, used here, is the one
// confirmed working end-to-end against the real signet server.
async function loadBark() {
  const [{ default: init, Wallet, generateMnemonic }, { default: wasmUrl }] = await Promise.all([
    import('@secondts/bark/web'),
    import('@secondts/bark/web/bark_ffi_wasm_bg.wasm?url'),
  ])
  await init({ module_or_path: wasmUrl })
  return { Wallet, generateMnemonic }
}

async function openWallet(pubkey: string, mnemonic: string): Promise<void> {
  setState({ status: 'opening', error: null })
  try {
    const { Wallet } = await loadBark()
    const wallet = await Wallet.open(
      'Signet',
      mnemonic,
      { serverAddress: ARK_SERVER_ADDRESS, esploraAddress: ARK_ESPLORA_ADDRESS },
      undefined,
      { runDaemon: false, indexedDbName: scopedIndexedDbName(pubkey) },
    )
    // The active identity may have changed again while this awaited —
    // if so, this result is stale: free it immediately rather than
    // clobbering whatever switchToIdentity() has since moved on to.
    if (pubkey !== currentWalletPubkey) {
      try {
        wallet.free()
      } catch {
        // best-effort
      }
      return
    }
    walletInstance = wallet
    const address = await walletInstance.newAddress()
    setState({ status: 'ready', address })
    await syncArkWallet()
  } catch (e) {
    if (pubkey === currentWalletPubkey) {
      setState({ status: 'error', error: e instanceof Error ? e.message : 'Could not open wallet' })
    }
  }
}

// Tears down whatever's currently open (regardless of whose it was) and
// opens whichever wallet belongs to `pubkey`, or resets to the empty
// state if that identity has never created one. This is what makes
// switching Nostr identity actually switch the Ark wallet shown too —
// called once at boot (openExistingArkWallet) and again automatically
// on every identity change via the ndk listener below.
async function switchToIdentity(pubkey: string | undefined): Promise<void> {
  if ((pubkey ?? null) === currentWalletPubkey) return
  try {
    walletInstance?.free()
  } catch {
    // best-effort cleanup of a WASM handle
  }
  walletInstance = null
  currentWalletPubkey = pubkey ?? null
  if (!pubkey) {
    setState({ status: 'none', address: null, balanceSats: null, syncing: false, error: null })
    return
  }
  migrateLegacyArkMnemonicIfNeeded(pubkey)
  const mnemonic = localStorage.getItem(scopedMnemonicKey(pubkey))
  if (!mnemonic) {
    setState({ status: 'none', address: null, balanceSats: null, syncing: false, error: null })
    return
  }
  await openWallet(pubkey, mnemonic)
}

// Reacts to every identity change — a local identity switch, a NIP-46/
// NIP-07 connect or disconnect, logging off — the same real-time way
// useActiveUser.ts's own consumers already do, so the Ark wallet shown
// in Settings never lags behind which Nostr identity is actually active.
ndk.on('activeUser:change', () => {
  switchToIdentity(ndk.activeUser?.pubkey)
})

// Called once at app boot (see App.tsx). Also correctly reflects
// whichever identity is already active if boot resolution finished
// before this runs — switchToIdentity() itself is idempotent (no-ops
// if already on the right identity), so this is safe to call
// unconditionally rather than only when nothing's open yet.
export async function openExistingArkWallet(): Promise<void> {
  await switchToIdentity(ndk.activeUser?.pubkey)
}

// Generates a fresh mnemonic, opens the wallet, and returns the
// mnemonic for a one-time reveal — mirrors AuthGate.tsx's own "Create
// new account" flow exactly (generate, show once with a warning, never
// show again).
export async function createArkWallet(): Promise<string> {
  const pubkey = ndk.activeUser?.pubkey
  if (!pubkey) throw new Error('No active identity to create a wallet for')
  const { generateMnemonic } = await loadBark()
  const mnemonic = generateMnemonic()
  saveArkMnemonic(pubkey, mnemonic)
  currentWalletPubkey = pubkey
  await openWallet(pubkey, mnemonic)
  return mnemonic
}

// Discards the current identity's wallet entirely — local storage only,
// no relay/server-side action, since this is nothing but an IndexedDB
// -persisted key pair the SDK itself owns. Safe by design (Signet, zero
// real value) precisely for the case this exists to cover: a mnemonic
// that was never actually saved has nothing worth recovering, so "start
// a fresh one" is a real, reasonable action, not just a last resort.
export async function forgetArkWallet(): Promise<void> {
  const pubkey = ndk.activeUser?.pubkey
  if (!pubkey) return
  // free() releases the WASM object's own IndexedDB connection — without
  // this, deleteDatabase() below can hang in the "blocked" state waiting
  // for a connection that's never going to close on its own.
  try {
    walletInstance?.free()
  } catch {
    // best-effort cleanup of a WASM handle; nothing meaningful to do if
    // it's already been freed or the call itself fails
  }
  walletInstance = null
  localStorage.removeItem(scopedMnemonicKey(pubkey))
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(scopedIndexedDbName(pubkey))
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
  setState({ status: 'none', address: null, balanceSats: null, syncing: false, error: null })
}

export async function syncArkWallet(): Promise<void> {
  if (!walletInstance) return
  setState({ syncing: true })
  try {
    await walletInstance.sync()
    const balance = await walletInstance.balance()
    setState({ syncing: false, balanceSats: balance.spendableSats })
  } catch (e) {
    setState({ syncing: false, error: e instanceof Error ? e.message : 'Sync failed' })
  }
}

// Ark-native send only, deliberately — the SDK's own `sendOnchain()` and
// the separate on-chain `OnchainWallet.send()` both need a real
// bitcoind/esplora-backed onchain handle this project never constructs
// (Wallet.open() is called with `onchain: undefined`), and Lightning
// send/receive (payLightningInvoice, bolt11Invoice, etc.) is real,
// separate scope of its own — see the "what's still missing" recap in
// nostr-client-node-strategy.md. This is the smallest useful next slice:
// an Ark address can now both receive (already built) and send.
// Left to throw its own real error rather than pre-validating the
// address/amount here — the SDK already rejects a malformed Ark address
// or an amount exceeding the spendable balance with a real, specific
// message, matching this project's own "surface the SDK's own
// validation" convention (e.g. NDKPrivateKeySigner in identities.ts).
export async function sendArkPayment(address: string, amountSats: number): Promise<void> {
  if (!walletInstance) throw new Error('No wallet open')
  await walletInstance.sendArkoorPayment(address, amountSats)
  await syncArkWallet()
}

export function useArkWallet(): ArkWalletState {
  return useSyncExternalStore(subscribe, () => state)
}
