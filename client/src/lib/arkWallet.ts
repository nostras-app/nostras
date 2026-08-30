import { useSyncExternalStore } from 'react'
import type { Wallet as ArkWalletHandle } from '@secondts/bark/web'

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
const ARK_MNEMONIC_KEY = 'nostras:ark-wallet-mnemonic'
const ARK_SERVER_ADDRESS = 'https://ark.signet.2nd.dev'
const ARK_ESPLORA_ADDRESS = 'https://esplora.signet.2nd.dev'
const ARK_INDEXED_DB_NAME = 'nostras-ark-signet-wallet'

export function loadArkMnemonic(): string | null {
  return localStorage.getItem(ARK_MNEMONIC_KEY)
}

function saveArkMnemonic(mnemonic: string): void {
  localStorage.setItem(ARK_MNEMONIC_KEY, mnemonic)
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

async function openWallet(mnemonic: string): Promise<void> {
  setState({ status: 'opening', error: null })
  try {
    const { Wallet } = await loadBark()
    walletInstance = await Wallet.open(
      'Signet',
      mnemonic,
      { serverAddress: ARK_SERVER_ADDRESS, esploraAddress: ARK_ESPLORA_ADDRESS },
      undefined,
      { runDaemon: false, indexedDbName: ARK_INDEXED_DB_NAME },
    )
    const address = await walletInstance.newAddress()
    setState({ status: 'ready', address })
    await syncArkWallet()
  } catch (e) {
    setState({ status: 'error', error: e instanceof Error ? e.message : 'Could not open wallet' })
  }
}

// Called once at app boot (see App.tsx) — silently reopens an existing
// wallet, no mnemonic reveal (that only ever happens once, at creation).
export async function openExistingArkWallet(): Promise<void> {
  const mnemonic = loadArkMnemonic()
  if (!mnemonic || state.status !== 'none') return
  await openWallet(mnemonic)
}

// Generates a fresh mnemonic, opens the wallet, and returns the
// mnemonic for a one-time reveal — mirrors AuthGate.tsx's own "Create
// new account" flow exactly (generate, show once with a warning, never
// show again).
export async function createArkWallet(): Promise<string> {
  const { generateMnemonic } = await loadBark()
  const mnemonic = generateMnemonic()
  saveArkMnemonic(mnemonic)
  await openWallet(mnemonic)
  return mnemonic
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

export function useArkWallet(): ArkWalletState {
  return useSyncExternalStore(subscribe, () => state)
}
