import { useEffect, useRef, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet, profileQueryRelaySet } from '../lib/ndk'
import { fetchLatestReplaceableEvent } from '../lib/fetchLatestReplaceable'
import { useProfile, setCachedProfile } from '../hooks/useProfile'
import { useActiveUser } from '../hooks/useActiveUser'
import { useUserStatus } from '../hooks/useUserStatus'
import { publishUserStatus, clearUserStatus } from '../lib/userStatus'
import { uploadToBlossom } from '../lib/blossom'
import { isSecureImageUrl } from '../lib/parseContent'
import { ImageIcon, UserIcon } from './icons'

const STATUS_EXPIRY_OPTIONS = [
  { label: 'Never', seconds: undefined },
  { label: '1 hour', seconds: 60 * 60 },
  { label: '24 hours', seconds: 24 * 60 * 60 },
] as const

type ImageField = 'picture' | 'banner'

export function ProfileEditor() {
  const activeUser = useActiveUser()
  const pubkey = activeUser?.pubkey
  const profile = useProfile(pubkey)
  // The raw kind:0 content, not just the NDKUserProfile-mapped fields —
  // saving merges edits onto this rather than replacing it wholesale, so
  // fields this form doesn't edit (nip05, lud16, website, etc.) survive a
  // save instead of being silently wiped. Same fetch-then-republish
  // precedent as useBookmark/useFollowing/useNip65RelayList.
  const [rawProfile, setRawProfile] = useState<Record<string, unknown>>({})
  // Whether the existing kind:0 was found. Saving while it's 'loading' or
  // 'missing' would publish a profile with only this form's fields and
  // wipe nip05/lud16/website etc. on every relay (2026-10-11: the
  // operator's profile was reachable only via purplepag.es, so this fetch
  // came back empty). 'missing' is allowed only after an explicit confirm,
  // since a brand-new identity genuinely has no profile yet.
  const [rawState, setRawState] = useState<'loading' | 'found' | 'missing'>('loading')
  const [confirmNew, setConfirmNew] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [picture, setPicture] = useState('')
  const [banner, setBanner] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<ImageField | null>(null)
  const [uploadError, setUploadError] = useState('')
  const pictureInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  // NIP-38 "general" status — separate save flow from the kind:0 profile
  // fields above, deliberately: different event kind (30315, addressable-
  // replaceable), different semantics (an empty content clears it, per
  // the spec itself), no reason to couple its lifecycle to the profile
  // form's own save/preserve-unknown-fields logic.
  const existingStatus = useUserStatus(pubkey)
  const [statusText, setStatusText] = useState('')
  const [statusUrl, setStatusUrl] = useState('')
  const [statusExpirySeconds, setStatusExpirySeconds] = useState<number | undefined>(undefined)
  const [statusSaving, setStatusSaving] = useState(false)
  const [statusError, setStatusError] = useState('')

  useEffect(() => {
    if (existingStatus) {
      setStatusText(existingStatus.content)
      setStatusUrl(existingStatus.url ?? '')
    }
  }, [existingStatus])

  async function handleStatusSave() {
    setStatusSaving(true)
    setStatusError('')
    try {
      await publishUserStatus(statusText.trim(), statusUrl, statusExpirySeconds)
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Could not update status')
    } finally {
      setStatusSaving(false)
    }
  }

  async function handleStatusClear() {
    setStatusSaving(true)
    setStatusError('')
    try {
      await clearUserStatus()
      setStatusText('')
      setStatusUrl('')
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Could not clear status')
    } finally {
      setStatusSaving(false)
    }
  }

  useEffect(() => {
    if (!pubkey) return
    let cancelled = false
    setRawState('loading')
    setConfirmNew(false)
    // fetchLatestReplaceableEvent, not plain ndk.fetchEvent() with no
    // relay set at all — the original had neither the authorQueryRelaySet
    // scoping fix (2026-08-09, the unscoped-CONNECTED-only-fallback bug)
    // nor this one (2026-08-17, closeOnEose's own convergence race). Both
    // matter more than usual here specifically: handleSave() below merges
    // edits onto whatever this fetch returns (`{...rawProfile, name,
    // about, picture, banner}`), so a stale/incomplete raw profile here
    // would silently wipe real fields (nip05, lud16, website, etc.) on
    // the very next save — the exact data-loss bug this fetch-then-
    // merge pattern was built to prevent in the first place.
    fetchLatestReplaceableEvent({ kinds: [0], authors: [pubkey] }, profileQueryRelaySet)
      .then((event) => {
        if (cancelled) return
        if (!event) {
          setRawProfile({})
          setRawState('missing')
          return
        }
        try {
          setRawProfile(JSON.parse(event.content))
          setRawState('found')
        } catch {
          setRawProfile({})
          setRawState('missing')
        }
      })
    return () => {
      cancelled = true
    }
  }, [pubkey])

  useEffect(() => {
    setName(profile?.name ?? '')
    setAbout(profile?.about ?? '')
    setPicture(profile?.picture ?? '')
    setBanner(profile?.banner ?? '')
  }, [profile])

  function handleUpload(field: ImageField, file: File | undefined) {
    if (!file) return
    setUploading(field)
    setUploadError('')
    uploadToBlossom(file)
      .then((blob) => {
        if (field === 'picture') setPicture(blob.url)
        else setBanner(blob.url)
      })
      .catch((e) => {
        setUploadError(e instanceof Error ? e.message : 'Upload failed')
      })
      .finally(() => setUploading(null))
  }

  async function handleSave() {
    if (!pubkey) return
    if (rawState === 'loading' || (rawState === 'missing' && !confirmNew)) return
    setSaving(true)
    setSaveError('')
    try {
      const newProfile = { ...rawProfile, name, about, picture, banner }
      const event = new NDKEvent(ndk, {
        kind: 0,
        content: JSON.stringify(newProfile),
      })
      await event.publish(devPublishRelaySet, 8000)
      setRawProfile(newProfile)
      setRawState('found')
      // The profile cache may already hold a stale (e.g. null) entry for
      // this pubkey from before this save — update it directly rather than
      // waiting on a relay round-trip that a subscription may not pick up.
      setCachedProfile(pubkey, newProfile)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save profile')
    } finally {
      setSaving(false)
    }
  }

  const busy = saving || uploading !== null

  return (
    <div className="stack">
      <div className="profile-header profile-editor-header">
        <div className="profile-editor-banner-wrap">
          {isSecureImageUrl(banner) ? (
            <img className="profile-banner" src={banner} alt="" />
          ) : (
            <div className="profile-banner profile-editor-banner-empty" />
          )}
          <button
            type="button"
            className="profile-editor-image-btn profile-editor-banner-btn"
            onClick={() => bannerInputRef.current?.click()}
            disabled={busy}
          >
            <ImageIcon />
            {uploading === 'banner' ? 'Uploading…' : 'Change banner'}
          </button>
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              handleUpload('banner', e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        <div className="profile-header-body">
          <div className="profile-editor-avatar-wrap">
            {isSecureImageUrl(picture) ? (
              <img className="profile-avatar" src={picture} alt="" />
            ) : (
              <span className="profile-avatar profile-avatar-fallback">
                <UserIcon />
              </span>
            )}
            <button
              type="button"
              className="profile-editor-image-btn profile-editor-avatar-btn"
              onClick={() => pictureInputRef.current?.click()}
              disabled={busy}
              title="Change profile photo"
            >
              <ImageIcon />
            </button>
            <input
              ref={pictureInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                handleUpload('picture', e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </div>

      {uploadError && <div className="alert-error">{uploadError}</div>}

      <div className="stack">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />
        <textarea
          className="textarea"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="About"
          rows={3}
        />
      </div>
      {rawState === 'loading' && (
        <p className="field-hint">Loading your current profile before saving is allowed…</p>
      )}
      {rawState === 'missing' && (
        <div className="stack">
          <p className="alert-error">
            Your existing profile wasn't found on any relay we checked. Saving now creates a new
            profile with only the fields above; anything else (NIP-05, Lightning address, website)
            would be lost.
          </p>
          <label className="field-hint">
            <input type="checkbox" checked={confirmNew} onChange={(e) => setConfirmNew(e.target.checked)} />{' '}
            I don't have an existing profile, create a new one
          </label>
        </div>
      )}
      {saveError && <p className="alert-error">{saveError}</p>}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleSave}
          disabled={busy || rawState === 'loading' || (rawState === 'missing' && !confirmNew)}
        >
          {saving ? 'Saving…' : uploading ? 'Uploading…' : 'Save profile'}
        </button>
      </div>

      <div className="stack profile-status-editor">
        <p className="field-hint">
          Status (NIP-38): a short "what I'm up to" line shown on your
          profile. Leave it blank and save to clear it.
        </p>
        <input
          className="input"
          value={statusText}
          onChange={(e) => setStatusText(e.target.value)}
          placeholder="e.g. Working, Hiking, Heads down on a release…"
          maxLength={140}
        />
        <input
          className="input"
          value={statusUrl}
          onChange={(e) => setStatusUrl(e.target.value)}
          placeholder="Link (optional)"
        />
        <div className="btn-row">
          {STATUS_EXPIRY_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={`btn btn-sm ${statusExpirySeconds === opt.seconds ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusExpirySeconds(opt.seconds)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {statusError && <p className="alert-error">{statusError}</p>}
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleStatusClear}
            disabled={statusSaving}
          >
            Clear status
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleStatusSave}
            disabled={statusSaving || !statusText.trim()}
          >
            {statusSaving ? 'Saving…' : 'Update status'}
          </button>
        </div>
      </div>
    </div>
  )
}
