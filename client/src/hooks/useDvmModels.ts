import { useEffect, useState } from 'react'
import { fetchDvmInfo, type DvmModel } from '../lib/dvm'

// The models the NOSTRAS DVM currently advertises in its NIP-89
// announcement. Empty while loading, or if the announcement has no model
// list (an older DVM), in which case jobs just run on the DVM's default.
export function useDvmModels(): { models: DvmModel[]; loading: boolean; error: string } {
  const [models, setModels] = useState<DvmModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchDvmInfo()
      .then((info) => {
        if (!cancelled) setModels(info.models)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not reach the DVM')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { models, loading, error }
}
