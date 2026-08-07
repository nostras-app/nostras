import { UsersIcon } from './icons'

// Roadmap placeholder, not a working feature yet — deliberate choice per
// the user: real user demand exists for this, but infrastructure
// reliability (the relay's own capacity/stability work) comes first. Lists
// the actual NIPs this would build on rather than vague marketing language,
// matching this project's own convention of NIP numbers as the shared
// vocabulary for protocol-defined behavior. Two of the five (NIP-51,
// NIP-56) already power real, shipped features elsewhere in NOSTRAS today
// (bookmarks/mute lists, note/user reporting) — called out explicitly
// rather than implying all five would be entirely new work.
const PLANNED_NIPS: { nip: string; title: string; description: string; existing?: string }[] = [
  {
    nip: 'NIP-29',
    title: 'Relay-based Groups',
    description:
      'Real-time group chat with membership and moderation roles, hosted directly on a relay — the core mechanic a "communities" feature would actually run on.',
  },
  {
    nip: 'NIP-72',
    title: 'Moderated Communities',
    description:
      'Reddit-style communities: a community definition anyone can create, with moderator-approved posts.',
  },
  {
    nip: 'NIP-32',
    title: 'Labeling',
    description:
      'Structured labels attached to events or people — how moderators would classify and organize content within a community.',
  },
  {
    nip: 'NIP-56',
    title: 'Reporting',
    description: 'Flagging content for review.',
    existing:
      "This already ships in NOSTRAS today for individual notes and users (the note menu's \"Report\" action) — community moderation would extend the same mechanism.",
  },
  {
    nip: 'NIP-51',
    title: 'Lists',
    description: 'Member lists, moderator lists, pinned posts.',
    existing:
      'This already powers bookmarks and the mute list in NOSTRAS today — communities would extend the same generic list mechanism.',
  },
]

export function CommunitiesView() {
  return (
    <div className="communities-view">
      <span className="communities-icon">
        <UsersIcon />
      </span>
      <h2 className="communities-heading">Communities</h2>
      <p className="communities-status">Not built yet — infrastructure reliability comes first</p>
      <p className="communities-lede">
        A real number of people using NOSTRAS have asked for this, and it's a
        real direction the app should grow in. It isn't built yet on
        purpose: the relay this app depends on needed real work first —
        capacity, memory, connection handling — and that work only just
        landed. Communities is next on the list, not off it.
      </p>

      <div className="communities-nips">
        {PLANNED_NIPS.map((n) => (
          <div className="communities-nip" key={n.nip}>
            <div className="communities-nip-head">
              <span className="communities-nip-badge">{n.nip}</span>
              <span className="communities-nip-title">{n.title}</span>
            </div>
            <p className="communities-nip-desc">{n.description}</p>
            {n.existing && <p className="communities-nip-existing">{n.existing}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
