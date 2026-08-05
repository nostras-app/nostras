// Must be the very first import — installs a hard guard on the global
// WebSocket constructor before any other app code (including lib/ndk.ts)
// runs. See wsGuard.ts for why relayConnectionFilter alone isn't enough.
import './lib/wsGuard'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
