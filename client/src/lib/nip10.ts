// NIP-10: preferred form marks each "e" tag with "root"/"reply"/"mention".
// The direct parent of a reply is the tag marked "reply" — or, when only a
// "root" tag is present (a reply directly to the root, no separate reply
// marker), that root tag doubles as the parent. Older clients omit markers
// entirely: the deprecated positional convention is first e-tag = root,
// last e-tag = the note actually being replied to. A "mention" tag is a
// quote, never the parent.
export function getReplyToEventId(tags: string[][]): string | undefined {
  const eTags = tags.filter((t) => t[0] === 'e' && t[1] && t[3] !== 'mention')
  if (eTags.length === 0) return undefined

  const marked = eTags.find((t) => t[3] === 'reply') ?? eTags.find((t) => t[3] === 'root')
  if (marked) return marked[1]

  return eTags[eTags.length - 1][1]
}

// The e tag naming the thread root this note belongs to, or undefined if
// the note is itself a root (no non-mention e tags). Without a "root"
// marker the first e tag is the best guess: positional replies put the
// root first, and NOSTRAS replies before 2026-10-27 carried only a
// "reply" tag, whose target is the closest thing to a root we have.
export function getRootTag(tags: string[][]): string[] | undefined {
  const eTags = tags.filter((t) => t[0] === 'e' && t[1] && t[3] !== 'mention')
  return eTags.find((t) => t[3] === 'root') ?? eTags[0]
}

// NIP-10 tags for a kind:1 reply to `parent`: a reply to a root marks it
// "root"; a reply further down carries the thread's root plus the parent
// marked "reply". The p tags are the parent's author plus everyone the
// parent already tagged, so the whole thread gets notified (minus ourselves).
export function buildReplyTags(
  parent: { id: string; pubkey: string; tags: string[][] },
  selfPubkey?: string,
): string[][] {
  const root = getRootTag(parent.tags)
  const eTags = root
    ? [
        ['e', root[1], root[2] ?? '', 'root', ...(root[4] ? [root[4]] : [])],
        ['e', parent.id, '', 'reply', parent.pubkey],
      ]
    : [['e', parent.id, '', 'root', parent.pubkey]]

  const pubkeys = [parent.pubkey, ...parent.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1])]
  const pTags = [...new Set(pubkeys)].filter((pk) => pk !== selfPubkey).map((pk) => ['p', pk])

  return [...eTags, ...pTags]
}

// The note a repost (NIP-18)/like (NIP-25)/zap receipt (NIP-57) was made
// against — these events carry a single plain (unmarked) "e" tag, never
// NIP-10's root/reply markers, so this is deliberately simpler than
// getReplyToEventId() above rather than reusing its marker-parsing logic
// for a kind it was never written for.
export function getReactedEventId(tags: string[][]): string | undefined {
  const eTags = tags.filter((t) => t[0] === 'e' && t[1])
  return eTags[eTags.length - 1]?.[1]
}
