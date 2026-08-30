import { useEffect, useState } from 'react'
import { getSavedNwcUri, getWalletBalanceMsat } from '../lib/nwc'
import { useActiveUser } from './useActiveUser'

// Sats, or null if no wallet is connected / the balance couldn't be
// fetched (e.g. this connection string is scoped without get_balance
// permission — some wallets narrow their NWC grant that way, same as
// this project's own DVM operator connection does deliberately
// elsewhere) — never thrown, just quietly unavailable.
export function useWalletBalance(): number | null {
  const activeUser = useActiveUser()
  const [balanceSats, setBalanceSats] = useState<number | null>(null)

  // getSavedNwcUri() already resolves the current identity — refetching
  // on activeUser?.pubkey changing (not just on mount) is what makes
  // this reflect that identity's own connected wallet after a switch,
  // instead of showing the previous identity's balance.
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
  }, [activeUser?.pubkey])

  return balanceSats
}
