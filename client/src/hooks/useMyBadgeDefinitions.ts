import { useCallback, useEffect, useState } from 'react'
import { useActiveUser } from './useActiveUser'
import { ndk, authorQueryRelaySet } from '../lib/ndk'
import { withTimeout } from '../lib/podcast'
import {
  KIND_BADGE_DEFINITION,
  parseBadgeDefinition,
  publishBadgeDefinition,
  type BadgeDefinition,
} from '../lib/badges'

const FETCH_TIMEOUT_MS = 8000

// Badges the active user has created (issuer side). kind:30009 is
// addressable, so one author can have many distinct `d`-tagged
// definitions — fetchEvents (plural), not fetchEvent, wrapped in an
// explicit timeout since fetchEvents has no internal one of its own
// (the same real hang class already fixed once for SearchView's content
// search).
export function useMyBadgeDefinitions() {
  const activeUser = useActiveUser()
  const [definitions, setDefinitions] = useState<BadgeDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!activeUser) {
      setDefinitions([])
      setLoading(false)
      return
    }
    setLoading(true)
    withTimeout(
      ndk.fetchEvents(
        { kinds: [KIND_BADGE_DEFINITION], authors: [activeUser.pubkey] },
        undefined,
        authorQueryRelaySet,
      ),
      FETCH_TIMEOUT_MS,
      'Timed out loading your badges',
    )
      .then((events) => {
        setDefinitions([...events].map(parseBadgeDefinition).sort((a, b) => a.d.localeCompare(b.d)))
      })
      .catch(() => setDefinitions([]))
      .finally(() => setLoading(false))
  }, [activeUser])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function createBadge(d: string, name: string, description: string, image: string): Promise<boolean> {
    if (!activeUser || creating) return false
    setCreating(true)
    setError(null)
    try {
      await publishBadgeDefinition(d, name, description, image)
      refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create badge')
      return false
    } finally {
      setCreating(false)
    }
  }

  return { definitions, loading, creating, error, createBadge }
}
