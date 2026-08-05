import { useState } from 'react'
import { isIOS, promptInstall, useInstallPrompt } from '../lib/pwaInstall'

export function InstallPwaSettings() {
  const { deferredPrompt, installed } = useInstallPrompt()
  const [dismissedResult, setDismissedResult] = useState(false)

  async function handleInstall() {
    const outcome = await promptInstall()
    if (outcome === 'dismissed') setDismissedResult(true)
  }

  if (installed) {
    return <p className="field-hint">NOSTRAS is installed on this device.</p>
  }

  if (isIOS()) {
    return (
      <p className="field-hint">
        On iOS, Safari doesn't support one-click install — tap the Share icon,
        then "Add to Home Screen".
      </p>
    )
  }

  if (deferredPrompt) {
    return (
      <div className="field-row" style={{ alignItems: 'center' }}>
        <p className="field-hint" style={{ flex: 1 }}>
          Install NOSTRAS as an app on this device — works offline-first and opens
          without a browser tab.
        </p>
        <button type="button" className="btn btn-primary btn-sm" onClick={handleInstall}>
          Install
        </button>
      </div>
    )
  }

  return (
    <p className="field-hint">
      {dismissedResult
        ? "Install dismissed — the option will come back next time you open NOSTRAS."
        : "Your browser doesn't offer one-click install here — check your browser menu for an \"Install app\" or \"Add to Home Screen\" option."}
    </p>
  )
}
