import { useEffect, useRef, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
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
    ndk
      .fetchEvent({ kinds: [0], authors: [pubkey] })
      .then((event) => {
        if (cancelled || !event) return
        try {
          setRawProfile(JSON.parse(event.content))
        } catch {
          setRawProfile({})
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
    setSaving(true)
    try {
      const newProfile = { ...rawProfile, name, about, picture, banner }
      const event = new NDKEvent(ndk, {
        kind: 0,
        content: JSON.stringify(newProfile),
      })
      await event.publish(devPublishRelaySet)
      setRawProfile(newProfile)
      // The profile cache may already hold a stale (e.g. null) entry for
      // this pubkey from before this save — update it directly rather than
      // waiting on a relay round-trip that a subscription may not pick up.
      setCachedProfile(pubkey, newProfile)
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
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleSave}
          disabled={busy}
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
