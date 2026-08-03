import { useEffect, useState } from 'react'
import { ndk, explicitRelayUrls } from './lib/ndk'
import './App.css'

type ConnectionState = 'connecting' | 'connected' | 'error'

function App() {
  const [state, setState] = useState<ConnectionState>('connecting')

  useEffect(() => {
    let cancelled = false

    ndk
      .connect()
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
      <ul>
        {explicitRelayUrls.map((url) => (
          <li key={url}>{url}</li>
        ))}
      </ul>
    </>
  )
}

export default App
