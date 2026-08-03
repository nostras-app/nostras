import { useEffect, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { ndk, devPublishRelaySet } from '../lib/ndk'
import { useProfile, setCachedProfile } from '../hooks/useProfile'
import { useActiveUser } from '../hooks/useActiveUser'

export function ProfileEditor() {
  const activeUser = useActiveUser()
  const pubkey = activeUser?.pubkey
  const profile = useProfile(pubkey)
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(profile?.name ?? '')
    setAbout(profile?.about ?? '')
  }, [profile])

  async function handleSave() {
    if (!pubkey) return
    setSaving(true)
    try {
      // Publish the kind:0 event directly (rather than NDKUser.publish(),
      // which has no relaySet param) so this stays scoped to the local
      // relay like note publishing does.
      const newProfile = { name, about }
      const event = new NDKEvent(ndk, {
        kind: 0,
        content: JSON.stringify(newProfile),
      })
      await event.publish(devPublishRelaySet)
      // The profile cache may already hold a stale (e.g. null) entry for
      // this pubkey from before this save — update it directly rather than
      // waiting on a relay round-trip that a subscription may not pick up.
      setCachedProfile(pubkey, newProfile)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack">
      <div className="field-row">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />
        <input
          className="input"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="About"
        />
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  )
}
