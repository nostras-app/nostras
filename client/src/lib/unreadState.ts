// Per-view "seen" markers backing the nav rail's unread badges
// (NavRail.tsx). Plain localStorage read/write, same shape as
// appData.ts's own loadFeedMode() — the actual cross-device sync lives in
// appData.ts's AppPreferences (NIP-78), which reads/writes through the
// functions here rather than touching localStorage directly, so there's
// exactly one place that knows the storage keys.
const LAST_SEEN_NOTIFICATIONS_KEY = 'nostras:last-seen-notifications'
const SEEN_MESSAGE_WRAP_IDS_KEY = 'nostras:seen-message-wrap-ids'

// Notification events (kind 1/6/7/9735) carry a real, honest
// `created_at` — a plain "newer than X" timestamp comparison is exactly
// right and correct here.
export function loadLastSeenNotifications(): number {
  return Number(localStorage.getItem(LAST_SEEN_NOTIFICATIONS_KEY) ?? 0)
}

export function saveLastSeenNotifications(unixSeconds: number): void {
  localStorage.setItem(LAST_SEEN_NOTIFICATIONS_KEY, String(unixSeconds))
}

// DMs can't use the same timestamp approach: NIP-59 deliberately
// randomizes a gift wrap's own outer `created_at` (see lib/dm.ts's own
// comment on this), specifically to prevent exactly this kind of
// metadata inference — so "newer than my last-seen timestamp" is
// meaningless for a wrap. What *is* honestly knowable without
// decrypting anything is which wrap ids have already been observed.
// Bounded to the same 200-item window useDirectMessages.ts itself ever
// fetches, so this can never grow unbounded (and stays a reasonably
// small NIP-78 payload).
export const MAX_SEEN_MESSAGE_WRAP_IDS = 200

export function loadSeenMessageWrapIds(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_MESSAGE_WRAP_IDS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export function saveSeenMessageWrapIds(ids: string[]): void {
  localStorage.setItem(
    SEEN_MESSAGE_WRAP_IDS_KEY,
    JSON.stringify(ids.slice(-MAX_SEEN_MESSAGE_WRAP_IDS)),
  )
}
