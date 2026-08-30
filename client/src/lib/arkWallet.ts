import { useSyncExternalStore } from 'react'
import type {
  ExitCancelResult,
  ExitVtxo,
  LightningSendStatus,
  OnchainWallet as OnchainWalletHandle,
  PendingBoard,
  Wallet as ArkWalletHandle,
} from '@secondts/bark/web'
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
const ONCHAIN_INDEXED_DB_NAME_PREFIX = 'nostras-ark-signet-onchain'
const ARK_SERVER_ADDRESS = 'https://ark.signet.2nd.dev'
const ARK_ESPLORA_ADDRESS = 'https://esplora.signet.2nd.dev'

function scopedMnemonicKey(pubkey: string): string {
  return `${ARK_MNEMONIC_KEY_PREFIX}:${pubkey}`
}

function scopedIndexedDbName(pubkey: string): string {
  return `${ARK_INDEXED_DB_NAME_PREFIX}-${pubkey}`
}

function scopedOnchainDbName(pubkey: string): string {
  return `${ONCHAIN_INDEXED_DB_NAME_PREFIX}-${pubkey}`
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
  // Boarding — moving on-chain Signet bitcoin into the Ark wallet. A
  // genuinely separate on-chain wallet (same mnemonic, different
  // derivation) backs this, since boarding requires managing real
  // on-chain UTXOs (confirmed against the real docs, not assumed —
  // see boardAllFunds()'s own comment).
  onchainAddress: string | null
  onchainBalanceSats: number | null
  onchainSyncing: boolean
  boarding: boolean
}

const EMPTY_STATE: ArkWalletState = {
  status: 'none',
  address: null,
  balanceSats: null,
  syncing: false,
  error: null,
  onchainAddress: null,
  onchainBalanceSats: null,
  onchainSyncing: false,
  boarding: false,
}

let state: ArkWalletState = { ...EMPTY_STATE }

// Type-only import above (erased at build time, never triggers the
// package's own runtime WASM-loading code) so this can be properly
// typed without eagerly importing the module outside loadBark()'s own
// dynamic import — the whole point of loading it dynamically there.
let walletInstance: ArkWalletHandle | null = null

// The on-chain half backing boarding — opened alongside walletInstance
// via Wallet.openWithOnchain() (which *borrows* this handle, keeping it
// independently usable, unlike plain Wallet.open()'s onchain param,
// which consumes it — see openWallet()'s own comment for why this
// matters). Same lifetime as walletInstance: freed and nulled together.
let onchainWalletInstance: OnchainWalletHandle | null = null

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
  const [{ default: init, Wallet, OnchainWallet, generateMnemonic }, { default: wasmUrl }] = await Promise.all([
    import('@secondts/bark/web'),
    import('@secondts/bark/web/bark_ffi_wasm_bg.wasm?url'),
  ])
  await init({ module_or_path: wasmUrl })
  return { Wallet, OnchainWallet, generateMnemonic }
}

async function openWallet(pubkey: string, mnemonic: string): Promise<void> {
  setState({ status: 'opening', error: null })
  try {
    const { Wallet, OnchainWallet } = await loadBark()
    const config = { serverAddress: ARK_SERVER_ADDRESS, esploraAddress: ARK_ESPLORA_ADDRESS }
    // Same mnemonic, a genuinely separate on-chain wallet (different key
    // derivation) — needed for boarding, which real Ark documentation
    // confirms requires managing on-chain UTXOs directly (see
    // boardAllFunds()'s own comment). openWithOnchain() *borrows* this
    // handle rather than consuming it (unlike plain open()'s onchain
    // param), so it stays independently usable afterward for its own
    // address()/balance()/sync() calls below.
    const onchain = await OnchainWallet.default({
      network: 'Signet',
      mnemonic,
      config,
      dbName: scopedOnchainDbName(pubkey),
    })
    const wallet = await Wallet.openWithOnchain(
      'Signet',
      mnemonic,
      config,
      onchain,
      { runDaemon: false, indexedDbName: scopedIndexedDbName(pubkey) },
    )
    // The active identity may have changed again while this awaited —
    // if so, this result is stale: free it immediately rather than
    // clobbering whatever switchToIdentity() has since moved on to.
    if (pubkey !== currentWalletPubkey) {
      try {
        wallet.free()
        onchain.free()
      } catch {
        // best-effort
      }
      return
    }
    walletInstance = wallet
    onchainWalletInstance = onchain
    const [address, onchainAddress] = await Promise.all([walletInstance.newAddress(), onchain.newAddress()])
    setState({ status: 'ready', address, onchainAddress })
    await Promise.all([syncArkWallet(), syncOnchainWallet()])
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
    onchainWalletInstance?.free()
  } catch {
    // best-effort cleanup of a WASM handle
  }
  walletInstance = null
  onchainWalletInstance = null
  currentWalletPubkey = pubkey ?? null
  if (!pubkey) {
    setState(EMPTY_STATE)
    return
  }
  migrateLegacyArkMnemonicIfNeeded(pubkey)
  const mnemonic = localStorage.getItem(scopedMnemonicKey(pubkey))
  if (!mnemonic) {
    setState(EMPTY_STATE)
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
    onchainWalletInstance?.free()
  } catch {
    // best-effort cleanup of a WASM handle; nothing meaningful to do if
    // it's already been freed or the call itself fails
  }
  walletInstance = null
  onchainWalletInstance = null
  localStorage.removeItem(scopedMnemonicKey(pubkey))
  await Promise.all(
    [scopedIndexedDbName(pubkey), scopedOnchainDbName(pubkey)].map(
      (dbName) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(dbName)
          req.onsuccess = () => resolve()
          req.onerror = () => resolve()
          req.onblocked = () => resolve()
        }),
    ),
  )
  setState(EMPTY_STATE)
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

// Separate from syncArkWallet() — a different underlying wallet handle
// (onchainWalletInstance, not walletInstance), needed to discover a
// board-funding UTXO after it's sent from outside this app (a faucet,
// another wallet). Real, independently confirmed error/success surface,
// same as every other sync path here.
export async function syncOnchainWallet(): Promise<void> {
  if (!onchainWalletInstance) return
  setState({ onchainSyncing: true })
  try {
    await onchainWalletInstance.sync()
    const balance = await onchainWalletInstance.balance()
    setState({ onchainSyncing: false, onchainBalanceSats: balance.confirmedSats })
  } catch (e) {
    setState({ onchainSyncing: false, error: e instanceof Error ? e.message : 'On-chain sync failed' })
  }
}

// Real recovery path for a real gap in plain sync(): the SDK's own doc
// comment on initialScan() is explicit — "sync only covers addresses
// this wallet instance has already revealed, so it never finds
// transactions made by a previous incarnation." A page reload between
// generating a boarding address and funding it is enough to trigger
// this — the reopened wallet calls newAddress() again and moves on,
// leaving the address that was actually funded outside what plain
// sync() will ever look at again. initialScan() does a real
// gap-limited scan across the whole address history instead of just
// the latest one (birthdayHeight is ignored against esplora, per the
// SDK's own doc comment — always a full scan here, not a partial one).
export async function rescanOnchainWallet(): Promise<void> {
  if (!onchainWalletInstance) return
  setState({ onchainSyncing: true })
  try {
    const totalSats = await onchainWalletInstance.initialScan()
    const balance = await onchainWalletInstance.balance()
    setState({ onchainSyncing: false, onchainBalanceSats: balance.confirmedSats ?? totalSats })
  } catch (e) {
    setState({ onchainSyncing: false, error: e instanceof Error ? e.message : 'Rescan failed' })
  }
}

// Boarding: moving on-chain Signet bitcoin into the Ark wallet. Real Ark
// documentation (second.tech/docs/learn/board.md, fetched and read
// directly, not assumed) confirms this genuinely requires managing
// on-chain UTXOs — "Users must: manage their own on-chain UTXOs to fund
// the boarding transaction" — which is exactly why openWallet() now
// constructs a real OnchainWallet alongside the Ark one, rather than
// this being reachable with only the Ark-side wallet. boardAll() takes
// no address/amount — it finds and spends whatever the on-chain wallet
// already knows about (hence the syncOnchainWallet() call first, so a
// UTXO that just arrived is actually visible before boarding tries to
// spend it) and boards the wallet's entire on-chain balance in one go —
// the simplest useful action for this first pass, not "board a specific
// amount" (also real, boardAmount(), left for later if ever needed).
// The boarded VTXO needs some real number of confirmations before it's
// spendable in Ark — see getRequiredBoardConfirmations() below for why
// that number is fetched live rather than hardcoded.
export async function boardAllFunds(): Promise<void> {
  if (!walletInstance) throw new Error('No wallet open')
  setState({ boarding: true, error: null })
  try {
    await syncOnchainWallet()
    await walletInstance.boardAll()
    await Promise.all([syncArkWallet(), syncOnchainWallet()])
  } finally {
    setState({ boarding: false })
  }
}

// Real gap found live: a successful boardAll() broadcasts a real
// transaction, but the Ark balance correctly stays 0 until it gets
// enough real confirmations — with nothing in the UI showing that a
// board is actually in flight, "balance still 0" reads as a failure
// rather than the expected wait it actually is. Wraps the SDK's own
// pendingBoards() so the UI can show real amount + a real txid to
// check independently, instead of just asserting "give it time."
export async function listPendingBoards(): Promise<PendingBoard[]> {
  if (!walletInstance) throw new Error('No wallet open')
  return walletInstance.pendingBoards()
}

// Real bug caught live (2026-08-30): the UI's own copy claimed boarded
// funds "need 6 real on-chain confirmations" — a number that was never
// actually read from anywhere, just assumed/guessed when this feature
// was first built. A real board on Second's live Signet server was
// confirmed to already be fully credited to the Ark balance at exactly
// 1 confirmation (checked directly against the block explorer, not
// assumed from the app's own UI) — proving the guessed "6" was simply
// wrong for this deployment. ArkInfo carries a real, live
// `requiredBoardConfirmations` field (sitting right next to
// `minBoardAmountSats`, which this file already correctly fetches live
// rather than guesses) — this is the actual, authoritative number the
// server itself enforces, and the only one that should ever appear in
// copy or logic here.
export async function getRequiredBoardConfirmations(): Promise<number> {
  if (!walletInstance) throw new Error('No wallet open')
  const info = await walletInstance.arkInfo()
  if (!info) throw new Error('Could not reach the Ark server for its required confirmation count')
  return info.requiredBoardConfirmations
}

// Real, user-hit gap: boarding a small on-chain balance can genuinely
// fail with "insufficient funds" even though the wallet correctly shows
// that balance as available to board — the amount has to cover both
// itself *and* real on-chain + Ark boarding fees, and a small enough
// amount can't clear that combined floor. Lets the UI show this before
// the user clicks "Board all", not just after it fails. Whatever the
// SDK actually does (returns a real negative-margin estimate, or throws
// its own "insufficient funds" the same way boardAll() itself does)
// this surfaces either outcome as-is, not guessed at.
export async function estimateBoardFee(amountSats: number): Promise<{ feeSats: number; netAmountSats: number }> {
  if (!walletInstance) throw new Error('No wallet open')
  const estimate = await walletInstance.estimateBoardFee(amountSats)
  return { feeSats: estimate.feeSats, netAmountSats: estimate.netAmountSats }
}

// A second, separate real floor discovered live — the fee check above
// doesn't catch this: boarding an amount below the server's own
// configured minimum fails with "board amount of X BTC does not meet
// minimum value of Y BTC", independent of whether fees are covered.
// Real, server-reported value via arkInfo(), not a number guessed from
// one observed error message (which could drift if the server's own
// config changes).
export async function getMinBoardAmountSats(): Promise<number> {
  if (!walletInstance) throw new Error('No wallet open')
  const info = await walletInstance.arkInfo()
  if (!info) throw new Error('Could not reach the Ark server for its minimum board amount')
  return info.minBoardAmountSats
}

// Ark-native send only, deliberately — the SDK's own `sendOnchain()` and
// the separate on-chain `OnchainWallet.send()` (both real, both wired
// up as of the boarding feature) send to a *plain on-chain* address,
// not an Ark one — a different, not-yet-built UI action of its own.
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

// Lightning receive — Ark's actual headline capability: an invoice
// whoever pays it can settle at any time, and the resulting VTXO lands
// in this wallet the next time it's online, with no channel to manage.
// Deliberately receive-only for this pass, matching this feature's own
// established one-direction-per-slice pattern (send then board, each
// its own commit) — paying a Lightning invoice out (payLightningInvoice
// et al.) is real, separate scope for a later pass.
export async function createLightningInvoice(
  amountSats: number,
  description?: string,
): Promise<{ invoice: string; paymentHash: string }> {
  if (!walletInstance) throw new Error('No wallet open')
  const result = await walletInstance.bolt11Invoice({ amountSats, description })
  return { invoice: result.invoice, paymentHash: result.paymentHash }
}

// Real progress states per the SDK's own type: "awaiting-payment" |
// "htlcs-ready" | "preimage-revealed" | "delivering" | "settled" — a
// one-shot check, not a poller (this feature deliberately runs with no
// background daemon — see openWallet()'s `runDaemon: false` — matching
// the same "explicit sync, not automatic" posture already established
// for the Ark and on-chain balances). Re-syncs the Ark balance
// afterward, in case the VTXO already landed.
export async function checkLightningReceive(paymentHash: string): Promise<string> {
  if (!walletInstance) throw new Error('No wallet open')
  const state = await walletInstance.lightningReceiveState(paymentHash)
  await syncArkWallet()
  return state.state
}

// Lightning send — the counterpart to receiving. `wait: true` blocks
// until the SDK itself resolves the payment (paid or failed) rather
// than returning an immediate in-progress status to poll — deliberately
// simpler than receive's fire-then-check shape, and consistent with
// sendArkPayment/boardAllFunds, which are also single blocking calls:
// the SDK's own LightningSend result (the "inProgress" case) carries no
// payment hash to poll against later, only receive's does, so a
// fire-then-check UI isn't actually reachable here the same way.
// Deliberately a raw bolt11 invoice only (no amount override for
// amount-less invoices, no LNURL/Lightning-address/BOLT12 offer
// support — payLightningAddress/payLnurl/payLightningOffer are all
// real, separate scope for a later pass) — the common case, matching
// this feature's own established smallest-slice-first pattern.
export async function payLightningInvoiceViaArk(invoice: string): Promise<LightningSendStatus> {
  if (!walletInstance) throw new Error('No wallet open')
  const status = await walletInstance.payLightningInvoice({ invoice: invoice.trim(), wait: true })
  await syncArkWallet()
  return status
}

// Emergency unilateral exit — the real safety guarantee this whole
// feature rests on: real docs (second.tech/docs/learn/vtxo.md, fetched
// and read directly) confirm every VTXO carries a genuine fallback
// spending path with real Bitcoin timelocks (absolute CLTV on root/
// branch transactions, a 144-block relative CSV on the leaf a user
// actually exits from) that needs no server cooperation at all —
// "converting a VTXO into a UTXO can be performed without any
// third-party interaction." startExitForEntireWallet() is what
// broadcasts that pre-signed transaction tree.
//
// Deliberately scoped to start/monitor/cancel only, not the final
// claim-to-spendable-balance step (drainExits -> signExitClaimInputs ->
// broadcastTx) — that three-call chain has no documentation covering
// its exact shape, and verifying it needs a genuinely funded VTXO to
// exit, which no wallet in this project has had access to yet (every
// board attempt so far has hit real "insufficient funds," see
// boardAllFunds()'s own history). Shipping a guessed implementation of
// the highest-stakes part of this feature, untested, was judged worse
// than deferring it — see nostr-client-node-strategy.md for the full
// scoping discussion. This is not a safety gap: once a VTXO reaches the
// exit's on-chain, timelock-secured state, the funds are already
// cryptographically the wallet owner's alone, independent of whether a
// "claim" button exists in this UI yet.
export async function startWalletExit(): Promise<void> {
  if (!walletInstance) throw new Error('No wallet open')
  await walletInstance.startExitForEntireWallet()
}

// Actively drives a started exit forward (broadcasting/rebroadcasting
// transactions as needed) — exits aren't a single fire-and-forget call,
// they need to be progressed over real block time, the same "explicit
// action, no background daemon" posture already established everywhere
// else in this feature (runDaemon: false).
export async function progressWalletExits(): Promise<void> {
  if (!walletInstance) throw new Error('No wallet open')
  await walletInstance.progressExits({})
}

export async function cancelWalletExit(vtxoId: string): Promise<ExitCancelResult> {
  if (!walletInstance) throw new Error('No wallet open')
  return walletInstance.cancelExit(vtxoId)
}

export async function getExitSummary(): Promise<{
  hasPending: boolean
  pendingSats: number
  vtxos: ExitVtxo[]
}> {
  if (!walletInstance) throw new Error('No wallet open')
  const [hasPending, pendingSats, vtxos] = await Promise.all([
    walletInstance.hasPendingExits(),
    walletInstance.pendingExitsTotalSats(),
    walletInstance.getExitVtxos(),
  ])
  return { hasPending, pendingSats, vtxos }
}

export function useArkWallet(): ArkWalletState {
  return useSyncExternalStore(subscribe, () => state)
}
