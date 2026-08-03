import { useEffect, useState } from 'react'
import { ndk } from './lib/ndk'
import { Composer } from './components/Composer'
import { Feed } from './components/Feed'
import { ProfileEditor } from './components/ProfileEditor'
import { SignerConnect } from './components/SignerConnect'
import './App.css'

type ConnectionState = 'connecting' | 'connected' | 'error'

function App() {
  const [state, setState] = useState<ConnectionState>('connecting')

  useEffect(() => {
    let cancelled = false

    // NDK.connect() waits for every relay in the set to connect and, with
    // no timeout, hangs forever if even one never does (e.g. an unreachable
    // public relay) — always pass a timeout so this resolves regardless.
    ndk
      .connect(5000)
      .then(() => {
        if (!cancelled) setState('connected')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <h1>NOSTRAS</h1>
      <p>Status: {state}</p>
      {state === 'connected' && (
        <>
          <SignerConnect />
          <ProfileEditor />
          <Composer />
          <Feed />
        </>
      )}
    </>
  )
}

export default App
