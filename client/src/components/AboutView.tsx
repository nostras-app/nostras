import { useState } from 'react'
import { nip19 } from '@nostr-dev-kit/ndk'
import { startDmWith } from '../lib/navigation'
import { MessageSquareIcon, ZapIcon } from './icons'

// Same text/links as the github.com/nostras-app org profile README (the
// project's own public-facing pitch), reused verbatim rather than
// paraphrased — minus "Try it", since a user opening this from inside the
// app is already using it.
const DEVELOPER_NPUB = 'npub1pks6z6dyu6zdpv9vrgmssu2hte9c70zkezn5zxul7le846nvjrnsncuyds'

export function AboutView() {
  const [copied, setCopied] = useState(false)

  function handleMessageDeveloper() {
    const decoded = nip19.decode(DEVELOPER_NPUB)
    if (decoded.type === 'npub') startDmWith(decoded.data)
  }

  function handleCopyNpub() {
    navigator.clipboard.writeText(DEVELOPER_NPUB)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="about-view">
      <h2 className="about-heading">Own Your Keys. Own Your Voice. Own Your Money.</h2>
      <p className="about-lede">
        A{' '}
        <a href="https://nostr.com" target="_blank" rel="noopener noreferrer" className="note-link">
          Nostr
        </a>{' '}
        client paired with a self-hosted relay — built for people who want
        their identity and their data under their own control, not a
        platform's.
      </p>

      <div className="about-links">
        <a href="https://github.com/nostras-app/nostras" target="_blank" rel="noopener noreferrer">
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

      <div className="about-developer">
        <p className="about-developer-label">Built by one developer, not a company</p>
        <button type="button" className="about-npub" onClick={handleCopyNpub}>
          {copied ? 'Copied!' : `${DEVELOPER_NPUB.slice(0, 20)}…`}
        </button>
        <div className="btn-row about-developer-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleMessageDeveloper}>
            <MessageSquareIcon /> Message the developer
          </button>
        </div>
        <p className="about-developer-hint">
          <ZapIcon /> Zap the npub above from any Nostr client to support this
          project directly.
        </p>
      </div>
    </div>
  )
}
