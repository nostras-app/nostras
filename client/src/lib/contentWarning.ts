// NIP-36: a real, standing gap flagged by the compliance audit — nothing
// in this app let an author mark a note sensitive, or hid one on the
// reader's side. Tag shape per the spec: ["content-warning", "<reason>"]
// — the reason is optional, so a bare ["content-warning"] tag is valid
// too (marked sensitive, no reason given).
//
// Returns null when the event isn't marked sensitive at all — distinct
// from '' (marked sensitive, no reason provided), which callers need to
// tell apart to decide whether to show a reason string.
export function getContentWarningReason(tags: string[][]): string | null {
  const tag = tags.find((t) => t[0] === 'content-warning')
  if (!tag) return null
  return tag[1] ?? ''
}
