import { useSyncExternalStore } from 'react'

// "Delete" for NIP-17 DMs, on this user's side only. Gift wraps are signed
// by a random throwaway key, so nobody (not even the recipient) can delete
// them from relays with NIP-09, and the other person keeps their own copy
// regardless. What we can do is stop showing them, and stop decrypting
// them on every load (the real cost for a bunker signer, see
// useDirectMessages.ts). Synced across devices through NIP-78 app data
// (lib/appData.ts), alongside the unread-DM marker.
//
// Two mechanisms:
//  - hiddenWrapIds: individual messages, by gift-wrap id.
//  - clearedBefore: per conversation, every message up to a timestamp
//    ("Clear chat"). Bounded storage no matter how long the history is.

const HIDDEN_IDS_KEY = 'nostras:dm-hidden-wrap-ids'
const CLEARED_BEFORE_KEY = 'nostras:dm-cleared-before'
export const MAX_HIDDEN_WRAP_IDS = 500

type DmHiddenState = {
  hiddenWrapIds: Set<string>
  clearedBefore: Record<string, number>
}

function readIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_IDS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function readCleared(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLEARED_BEFORE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === 'number'),
    ) as Record<string, number>
  } catch {
    return {}
  }
}

let state: DmHiddenState = { hiddenWrapIds: new Set(readIds()), clearedBefore: readCleared() }
const listeners = new Set<() => void>()

function commit(next: DmHiddenState) {
  state = next
  localStorage.setItem(
    HIDDEN_IDS_KEY,
    JSON.stringify([...next.hiddenWrapIds].slice(-MAX_HIDDEN_WRAP_IDS)),
  )
  localStorage.setItem(CLEARED_BEFORE_KEY, JSON.stringify(next.clearedBefore))
  for (const l of listeners) l()
}

export function useDmHidden(): DmHiddenState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export function hideDmMessage(wrapId: string) {
  const ids = new Set(state.hiddenWrapIds)
  ids.add(wrapId)
  commit({ ...state, hiddenWrapIds: ids })
}

// Hides every message in a conversation up to now: the marker covers
// anything (including messages not loaded yet), and the ids let the
// messages already loaded skip decryption on the next reload.
export function clearDmConversation(peerPubkey: string, wrapIds: string[], upToUnixSeconds: number) {
  const ids = new Set(state.hiddenWrapIds)
  for (const id of wrapIds) ids.add(id)
  const current = state.clearedBefore[peerPubkey] ?? 0
  commit({
    hiddenWrapIds: ids,
    clearedBefore: {
      ...state.clearedBefore,
      [peerPubkey]: Math.max(current, upToUnixSeconds),
    },
  })
}

export function isDmHidden(wrapId: string, peerPubkey: string, createdAt: number): boolean {
  return state.hiddenWrapIds.has(wrapId) || createdAt <= (state.clearedBefore[peerPubkey] ?? 0)
}

// Before decrypting: hidden messages are skipped entirely, which is what
// makes reloads cheaper. "Clear chat" also adds that conversation's
// current message ids here (see clearDmConversation's callers), so a
// cleared chat doesn't get decrypted again either.
export function canSkipDecrypt(wrapId: string): boolean {
  return state.hiddenWrapIds.has(wrapId)
}

// NIP-78 sync (lib/appData.ts).
export function loadDmHiddenForSync() {
  return {
    hiddenWrapIds: [...state.hiddenWrapIds].slice(-MAX_HIDDEN_WRAP_IDS),
    clearedBefore: state.clearedBefore,
  }
}

// Union of ids, newest marker per conversation. Never un-hides anything.
export function mergeDmHiddenFromSync(remote: {
  hiddenWrapIds?: unknown
  clearedBefore?: unknown
}) {
  const ids = new Set(state.hiddenWrapIds)
  if (Array.isArray(remote.hiddenWrapIds)) {
    for (const id of remote.hiddenWrapIds) if (typeof id === 'string') ids.add(id)
  }
  const cleared = { ...state.clearedBefore }
  if (remote.clearedBefore && typeof remote.clearedBefore === 'object') {
    for (const [peer, ts] of Object.entries(remote.clearedBefore as Record<string, unknown>)) {
      if (typeof ts === 'number' && ts > (cleared[peer] ?? 0)) cleared[peer] = ts
    }
  }
  commit({ hiddenWrapIds: ids, clearedBefore: cleared })
}
