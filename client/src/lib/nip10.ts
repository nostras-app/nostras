// NIP-10: preferred form marks each "e" tag with "root"/"reply"/"mention".
// The direct parent of a reply is the tag marked "reply" — or, when only a
// "root" tag is present (a reply directly to the root, no separate reply
// marker), that root tag doubles as the parent. Older clients (and this
// app's own reply composer never emits this form, but plenty of real
// public notes still do) omit markers entirely: the deprecated positional
// convention is first e-tag = root, last e-tag = the note actually being
// replied to.
export function getReplyToEventId(tags: string[][]): string | undefined {
  const eTags = tags.filter((t) => t[0] === 'e' && t[1])
  if (eTags.length === 0) return undefined

  const marked = eTags.find((t) => t[3] === 'reply') ?? eTags.find((t) => t[3] === 'root')
  if (marked) return marked[1]

  return eTags[eTags.length - 1][1]
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
