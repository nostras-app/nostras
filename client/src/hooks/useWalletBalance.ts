import { useEffect, useState } from 'react'
import { getSavedNwcUri, getWalletBalanceMsat } from '../lib/nwc'

// Sats, or null if no wallet is connected / the balance couldn't be
// fetched (e.g. this connection string is scoped without get_balance
// permission — some wallets narrow their NWC grant that way, same as
// this project's own DVM operator connection does deliberately
// elsewhere) — never thrown, just quietly unavailable.
export function useWalletBalance(): number | null {
  const [balanceSats, setBalanceSats] = useState<number | null>(null)

  useEffect(() => {
    const uri = getSavedNwcUri()
    if (!uri) {
      setBalanceSats(null)
      return
    }

    let cancelled = false
    getWalletBalanceMsat(uri)
      .then((msat) => {
        if (!cancelled) setBalanceSats(Math.floor(msat / 1000))
      })
      .catch(() => {
        if (!cancelled) setBalanceSats(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return balanceSats
}
