import { useProfileBadges } from '../hooks/useProfileBadges'
import { useBadgeDefinition } from '../hooks/useBadgeDefinition'
import { isSecureImageUrl } from '../lib/parseContent'
import type { ProfileBadgeEntry } from '../lib/badges'

function BadgeIcon({ entry }: { entry: ProfileBadgeEntry }) {
  const definition = useBadgeDefinition(entry.address)
  // Nothing to show yet (still fetching) or the address didn't resolve
  // to a real badge definition at all — fail closed to nothing rendered,
  // rather than a broken placeholder for every unresolved entry.
  if (!definition) return null
  const icon = definition.thumb || definition.image
  const title = definition.description ? `${definition.name}: ${definition.description}` : definition.name || definition.d
  return (
    <span className="profile-badge-icon" title={title}>
      {isSecureImageUrl(icon) ? (
        <img src={icon} alt={definition.name || definition.d} />
      ) : (
        <span className="badge-icon-fallback">{(definition.name || definition.d).charAt(0).toUpperCase()}</span>
      )}
    </span>
  )
}

// NIP-58 badges a profile has chosen to accept and display — shown as
// that profile's own claim (same posture as NIP-39 linked accounts:
// their own "i" tags aren't independently re-verified either), not a
// stronger guarantee than the profile owner's own kind:10008 actually
// carries.
export function ProfileBadgeRow({ pubkey }: { pubkey: string | undefined }) {
  const entries = useProfileBadges(pubkey)
  if (entries.length === 0) return null
  return (
    <div className="profile-badges-row" title="Badges this profile has chosen to display (NIP-58)">
      {entries.map((entry) => (
        <BadgeIcon key={entry.awardEventId} entry={entry} />
      ))}
    </div>
  )
}
