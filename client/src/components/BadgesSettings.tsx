import { useState } from 'react'
import { useActiveUser } from '../hooks/useActiveUser'
import { useMyBadgeDefinitions } from '../hooks/useMyBadgeDefinitions'
import { useReceivedBadgeAwards } from '../hooks/useReceivedBadgeAwards'
import { useMyProfileBadges } from '../hooks/useMyProfileBadges'
import { useBadgeDefinition } from '../hooks/useBadgeDefinition'
import { useProfile } from '../hooks/useProfile'
import { publishBadgeAward, type BadgeAward, type BadgeDefinition } from '../lib/badges'
import { resolvePubkeyInput } from '../lib/resolvePubkey'
import { uploadToBlossom } from '../lib/blossom'
import { isSecureImageUrl } from '../lib/parseContent'

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || `badge-${Date.now()}`
}

function AwardedBadgeRow({
  award,
  accepted,
  onAccept,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  busy,
}: {
  award: BadgeAward
  accepted: boolean
  onAccept: () => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  busy: boolean
}) {
  const definition = useBadgeDefinition(award.address)
  const issuer = useProfile(award.issuerPubkey)
  const issuerLabel = issuer?.name || issuer?.displayName || `${award.issuerPubkey.slice(0, 12)}…`

  return (
    <li className="linked-account-row">
      {isSecureImageUrl(definition?.thumb || definition?.image) ? (
        <img className="badge-icon" src={definition!.thumb || definition!.image} alt="" />
      ) : (
        <span className="badge-icon badge-icon-fallback">
          {(definition?.name || definition?.d || '?').charAt(0).toUpperCase()}
        </span>
      )}
      <span className="linked-account-platform">
        {definition?.name || definition?.d || 'Unknown badge'}
      </span>
      <span className="field-hint">from {issuerLabel}</span>
      {accepted && (
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onMoveUp} disabled={busy || !canMoveUp}>
            ↑
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onMoveDown} disabled={busy || !canMoveDown}>
            ↓
          </button>
        </>
      )}
      <button
        type="button"
        className={`btn btn-sm ${accepted ? 'btn-secondary' : 'btn-primary'}`}
        onClick={accepted ? onRemove : onAccept}
        disabled={busy}
      >
        {busy ? '…' : accepted ? 'Remove from profile' : 'Show on profile'}
      </button>
    </li>
  )
}

function CreatedBadgeRow({ definition }: { definition: BadgeDefinition }) {
  return (
    <li className="linked-account-row">
      {isSecureImageUrl(definition.image) ? (
        <img className="badge-icon" src={definition.image} alt="" />
      ) : (
        <span className="badge-icon badge-icon-fallback">{(definition.name || definition.d).charAt(0).toUpperCase()}</span>
      )}
      <span className="linked-account-platform">{definition.name || definition.d}</span>
      {definition.description && <span className="field-hint">{definition.description}</span>}
    </li>
  )
}

// NIP-58 badges: create a badge (issuer), award it to another pubkey,
// and choose which of the badges awarded to you get displayed on your
// own profile — and in what order. Real security boundary, not just a
// UI nicety: the "awarded to you" list below only ever comes from
// useReceivedBadgeAwards(activeUser.pubkey), which by construction only
// returns awards genuinely p-tagged to this exact pubkey — that's what
// makes "Show on profile" trustworthy, see useMyProfileBadges.ts's own
// comment on accept().
export function BadgesSettings() {
  const activeUser = useActiveUser()
  const { definitions, loading: definitionsLoading, creating, error: createError, createBadge } = useMyBadgeDefinitions()
  const { awards, loading: awardsLoading } = useReceivedBadgeAwards(activeUser?.pubkey)
  const {
    entries,
    accept,
    remove,
    moveUp,
    moveDown,
    busy: profileBusy,
    loading: profileLoading,
    error: profileError,
  } = useMyProfileBadges()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const [awardBadgeD, setAwardBadgeD] = useState('')
  const [recipientInput, setRecipientInput] = useState('')
  const [awarding, setAwarding] = useState(false)
  const [awardError, setAwardError] = useState('')
  const [awardSuccess, setAwardSuccess] = useState(false)

  function handleUpload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setUploadError('')
    uploadToBlossom(file)
      .then((blob) => setImage(blob.url))
      .catch((e) => setUploadError(e instanceof Error ? e.message : 'Upload failed'))
      .finally(() => setUploading(false))
  }

  async function handleCreate() {
    if (!name.trim()) return
    const ok = await createBadge(slugify(name), name.trim(), description.trim(), image)
    if (ok) {
      setName('')
      setDescription('')
      setImage('')
    }
  }

  async function handleAward() {
    const recipient = resolvePubkeyInput(recipientInput)
    const def = definitions.find((d) => d.d === awardBadgeD)
    if (!recipient || !def) return
    setAwarding(true)
    setAwardError('')
    setAwardSuccess(false)
    try {
      await publishBadgeAward(def.address, [recipient])
      setRecipientInput('')
      setAwardSuccess(true)
    } catch (e) {
      setAwardError(e instanceof Error ? e.message : 'Failed to award badge')
    } finally {
      setAwarding(false)
    }
  }

  return (
    <div className="stack">
      <p className="field-hint">
        Badges (NIP-58): create a badge, award it to another pubkey, and
        choose which ones you've received to display on your own
        profile — and in what order. Anyone can see a profile's chosen
        badges; they're shown as that profile's own accepted claim, same
        as linked accounts above, not independently re-verified beyond
        confirming the award was genuinely addressed to them.
      </p>

      <p className="settings-subsection-title">Badges you've created</p>
      {definitionsLoading ? (
        <p className="field-hint">Loading…</p>
      ) : definitions.length === 0 ? (
        <p className="field-hint">None yet.</p>
      ) : (
        <ul className="linked-accounts-list">
          {definitions.map((d) => (
            <CreatedBadgeRow key={d.d} definition={d} />
          ))}
        </ul>
      )}
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Badge name" />
      <input
        className="input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
      />
      <input
        type="file"
        accept="image/*"
        onChange={(e) => handleUpload(e.target.files?.[0])}
      />
      {image && isSecureImageUrl(image) && <img className="badge-icon-preview" src={image} alt="" />}
      {uploading && <p className="field-hint">Uploading…</p>}
      {uploadError && <p className="alert-error">{uploadError}</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? 'Creating…' : 'Create badge'}
        </button>
      </div>
      {createError && <p className="alert-error">{createError}</p>}

      <p className="settings-subsection-title">Award a badge</p>
      {definitions.length === 0 ? (
        <p className="field-hint">Create a badge first.</p>
      ) : (
        <>
          <div className="btn-row">
            {definitions.map((d) => (
              <button
                key={d.d}
                type="button"
                className={`btn btn-sm ${awardBadgeD === d.d ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setAwardBadgeD(d.d)}
              >
                {d.name || d.d}
              </button>
            ))}
          </div>
          <input
            className="input"
            value={recipientInput}
            onChange={(e) => setRecipientInput(e.target.value)}
            placeholder="Recipient npub or pubkey"
          />
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleAward}
              disabled={awarding || !awardBadgeD || !recipientInput.trim()}
            >
              {awarding ? 'Awarding…' : 'Award badge'}
            </button>
          </div>
          {awardSuccess && <p className="field-hint">Awarded.</p>}
          {awardError && <p className="alert-error">{awardError}</p>}
        </>
      )}

      <p className="settings-subsection-title">Badges awarded to you</p>
      {awardsLoading || profileLoading ? (
        <p className="field-hint">Loading…</p>
      ) : awards.length === 0 ? (
        <p className="field-hint">None yet.</p>
      ) : (
        <ul className="linked-accounts-list">
          {awards.map((award) => {
            const acceptedIndex = entries.findIndex((e) => e.awardEventId === award.id)
            const accepted = acceptedIndex !== -1
            return (
              <AwardedBadgeRow
                key={award.id}
                award={award}
                accepted={accepted}
                onAccept={() => accept(award.address, award.id)}
                onRemove={() => remove(award.id)}
                onMoveUp={() => moveUp(acceptedIndex)}
                onMoveDown={() => moveDown(acceptedIndex)}
                canMoveUp={accepted && acceptedIndex > 0}
                canMoveDown={accepted && acceptedIndex < entries.length - 1}
                busy={profileBusy}
              />
            )
          })}
        </ul>
      )}
      {profileError && <p className="alert-error">{profileError}</p>}
    </div>
  )
}
