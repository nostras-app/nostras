import { useEffect, useRef, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useProfile, setCachedProfile } from '../hooks/useProfile'
import { useActiveUser } from '../hooks/useActiveUser'
import { uploadToBlossom } from '../lib/blossom'
import { ImageIcon, UserIcon } from './icons'

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
          {banner ? (
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
            {picture ? (
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
    </div>
  )
}
