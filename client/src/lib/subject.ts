// NIP-14: a ["subject", "<text>"] tag on a kind:1 event. Metadata
// separate from content — meant for a thread-list "email subject line"
// style display, not folded into the note body itself.
export function getSubject(tags: string[][]): string | null {
  return tags.find((t) => t[0] === 'subject')?.[1] ?? null
}

// Per the spec: clients "MAY adorn the subject to denote that it is a
// reply, e.g. by prepending 'Re:'." Avoids stacking "Re: Re: Re:" on a
// reply chain that already carries the prefix, matching ordinary email
// convention rather than the spec's own more literal reading.
export function replySubject(parentSubject: string | null): string | null {
  if (!parentSubject) return null
  return /^re:/i.test(parentSubject) ? parentSubject : `Re: ${parentSubject}`
}
