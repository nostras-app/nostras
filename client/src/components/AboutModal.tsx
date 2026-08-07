import { useEffect, useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import { startDmWith } from '../lib/navigation'
import { XIcon, MessageSquareIcon, ZapIcon } from './icons'

// Same text/links as the github.com/nostras-app org profile README (the
// project's own public-facing pitch), reused verbatim rather than
// paraphrased — minus "Try it", since a user opening this from inside the
// app is already using it.
const DEVELOPER_NPUB = 'npub1pks6z6dyu6zdpv9vrgmssu2hte9c70zkezn5zxul7le846nvjrnsncuyds'

export function AboutModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function handleMessageDeveloper() {
    const decoded = nip19.decode(DEVELOPER_NPUB)
    if (decoded.type === 'npub') startDmWith(decoded.data)
    onClose()
  }

  function handleCopyNpub() {
    navigator.clipboard.writeText(DEVELOPER_NPUB)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card about-modal"
        role="dialog"
        aria-modal="true"
        aria-label="About NOSTRAS"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onClose} title="Close">
          <XIcon />
        </button>

        <h2 className="about-modal-heading">Own Your Keys. Own Your Voice. Own Your Money.</h2>
        <p className="about-modal-lede">
          A{' '}
          <a href="https://nostr.com" target="_blank" rel="noopener noreferrer" className="note-link">
            Nostr
          </a>{' '}
          client paired with a self-hosted relay — built for people who want
          their identity and their data under their own control, not a
          platform's.
        </p>

        <div className="about-modal-links">
          <a
            href="https://github.com/nostras-app/nostras"
            target="_blank"
            rel="noopener noreferrer"
          >
            Docs &amp; Support
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://github.com/nostras-app/nostras/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report an issue
          </a>
        </div>

        <div className="about-modal-developer">
          <p className="about-modal-developer-label">Built by one developer, not a company</p>
          <button type="button" className="about-modal-npub" onClick={handleCopyNpub}>
            {copied ? 'Copied!' : `${DEVELOPER_NPUB.slice(0, 20)}…`}
          </button>
          <div className="about-modal-developer-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleMessageDeveloper}>
              <MessageSquareIcon /> Message the developer
            </button>
          </div>
          <p className="about-modal-developer-hint">
            <ZapIcon /> Zap the npub above from any Nostr client to support this
            project directly.
          </p>
        </div>
      </div>
    </div>
  )
}
