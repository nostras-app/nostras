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
          Source code
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

      {/* Same longer narrative already published on the github.com/nostras-app
          org profile README, reproduced verbatim (not paraphrased) per the
          user's explicit request to add it here too. */}
      <div className="about-essay">
        <h3 className="about-essay-intro">I owe you the why NOSTRAS:</h3>

        <h4>The web we settled for</h4>
        <p>
          The internet was built on a bet: that if you let anyone publish,
          anyone read, and anyone find each other, the result would be better
          than any gatekeeper could design. For a while that bet paid off.
        </p>
        <p>
          Then the economics took over. What was once a sprawl of independent
          pages consolidated into a handful of data centres owned by a
          handful of companies — and used by most of the planet. Convenience
          was the trade, and we made it without reading the terms.
        </p>
        <p>Look at what actually changed hands:</p>
        <ul>
          <li>
            Your identity now lives in someone else's user table. It can be
            suspended, renamed, or deleted by a decision you'll never see.
          </li>
          <li>Your work is uploaded under licences you agreed to by scrolling past them.</li>
          <li>
            Your attention is routed by ranking systems tuned for engagement,
            not for you.
          </li>
        </ul>
        <p>
          The result is a small number of private entities deciding, at
          planetary scale, what gets seen and what quietly disappears. That
          isn't a moderation problem. It's a structural one — and you can't
          fix a structural problem with better policies from the same owners.
        </p>

        <hr className="about-divider" />

        <h4>Nostr: fixing the structure, not the policy</h4>
        <p>
          Nostr — Notes and Other Stuff Transmitted by Relays — removes the
          assumption that made all of this possible: that your data has to
          live on a server somebody else owns.
        </p>
        <p>
          It isn't an app or a company. It's a protocol, in the same sense as
          HTTP or SMTP: a small set of rules anyone can implement without
          asking permission. Events are plain JSON. Identity is a keypair.
          Every event is signed, so anyone can verify who wrote it and prove
          it hasn't been altered.
        </p>
        <p>
          Two roles, and that's the whole system. Clients are what you use.
          Relays pass messages along and store them, and anyone can run one —
          an individual, a business, a community, you. No relay is
          load-bearing. The protocol assumes relays will vanish, so you
          publish to several and swap them out whenever you like. Nothing
          about your identity or your audience depends on any one of them
          surviving.
        </p>
        <p>
          Think of it as email versus a walled social network: if your
          provider goes down, your name and your contacts are still yours,
          and you carry them somewhere else the same afternoon.
        </p>

        <hr className="about-divider" />

        <h4>What you get back</h4>
        <p>
          <strong>An identity nobody issues you.</strong> Your account is a
          cryptographic keypair you generate. No email, no phone number, no
          ID scan, no KYC. Nobody grants it, so nobody can revoke it.
        </p>
        <p>
          <strong>Proof instead of trust.</strong> Every post carries your
          signature. Clients check it on arrival. You can demonstrate what
          you wrote — and, just as usefully, what you didn't.
        </p>
        <p>
          <strong>An audience that travels with you.</strong> Your follow
          list is published to relays you choose, not held in a company's
          database. Change client, change relay, keep everyone. Relays can
          also earn their keep: filtering spam, curating feeds, serving
          communities.
        </p>
        <p>
          <strong>Speech that doesn't need approval.</strong> Relays set
          their own policies — that's their right, and healthy. What's
          different is what happens when every relay says no: you run your
          own, and clients follow the hints back to you. Refusal by one
          operator is no longer removal from the network.
        </p>
        <p>
          <strong>Anonymity as a supported mode.</strong> Use your real name
          or a pseudonym; both work identically. Nostr runs over Tor. The
          protocol itself holds nothing to hand over, and any single relay or
          client can only ever surrender what it actually has — which, for a
          careful user, is a public key.
        </p>
        <p>
          <strong>Permissionless building.</strong> No API keys, no partner
          programme, no revocable access. Every client, relay, and tool built
          on Nostr compounds with every other one, past and future.
        </p>

        <hr className="about-divider" />

        <h4>Why not the alternatives</h4>
        <p>
          Ad-funded platforms monetise attention, so they optimise for
          whatever holds it — which turns out to be outrage. The ranking is
          secret, unchangeable, and not on your side.
        </p>
        <p>
          Federated networks move the gatekeeper without removing it. Tying
          identity to a domain means the domain owner still holds the off
          switch, servers still defederate each other, and migration only
          works if two admins cooperate. Instances get abandoned, and
          everyone who signed up there is stranded. Smaller landlord, same
          lease.
        </p>
        <p>Nostr breaks the link entirely: identity is a key, not an account on a machine.</p>

        <hr className="about-divider" />

        <h4>Why NOSTRAS</h4>
        <ul>
          <li>
            <strong>Non-custodial, always.</strong> NOSTRAS never holds your
            keys or your funds. Bring your own signer, bring your own
            Lightning wallet.
          </li>
          <li>
            <strong>Built on the open protocol, not a walled garden.</strong>{' '}
            Every feature — search, translation, AI-assisted tools — is a
            standard, publicly specified Nostr Improvement Proposal (NIP),
            interoperable with the rest of the network.
          </li>
          <li>
            <strong>Open source, and still verifiable.</strong> The code is{' '}
            <a
              href="https://github.com/nostras-app/nostras"
              target="_blank"
              rel="noopener noreferrer"
            >
              public under the AGPL-3.0
            </a>
            , and every guarantee is also checkable from outside, on the wire.
          </li>
        </ul>

        <h4>Where NOSTRAS comes in</h4>
        <p>Nostr gives you the guarantees. NOSTRAS is how you actually run them.</p>
        <p>
          <strong>A client and a relay, shipped together.</strong> Most
          clients hand you the protocol's promises and then leave you renting
          storage from strangers' relays. NOSTRAS pairs the client with a
          relay you host — so the copy of your history that matters is on
          hardware you control.
        </p>
        <p>
          <strong>Non-custodial, permanently.</strong> Your keys are never
          ours to hold. Bring your own signer, bring your own Lightning
          wallet. There is no version of NOSTRAS that has a recovery flow,
          because there is nothing on our side to recover from.
        </p>
        <p>
          <strong>Standards, not features.</strong> Search, translation,
          AI-assisted tooling — everything ships as a specified NIP and
          interoperates with the rest of the network. Nothing here works only
          if you stay.
        </p>
        <p>
          <strong>Open source, and still verifiable.</strong> The client,
          relay and DVM are{' '}
          <a
            href="https://github.com/nostras-app/nostras"
            target="_blank"
            rel="noopener noreferrer"
          >
            open source under the AGPL-3.0
          </a>
          : read them, build them, run your own. But you don't have to take
          the code on trust, because the guarantees don't live in it. Every
          claim NOSTRAS makes is checkable from outside: signed events, open
          specs, a relay you can inspect yourself.
        </p>

        <hr className="about-divider" />

        <p className="about-closing-label">A closing word, from me directly.</p>
        <p>
          I didn't arrive at this from ideology — I arrived at it from work.
          Outside NOSTRAS, I build payment infrastructure that lets software
          pay its own way in sats, settled on a node I control, never on
          someone else's promise. The rule is always the same, whatever I'm
          building: keys stay on hardware you own, limits are hard caps
          nothing can exceed, and nothing counts as paid until it's actually
          settled. I've watched a complete stranger send value to something I
          built and get something real back, automatically, with no account
          on either side and nobody's permission required. That moment is
          this whole essay, compressed into one transaction.
        </p>
        <p>
          NOSTRAS applies the same conviction somewhere more personal — not
          infrastructure something else runs on, but the actual place where
          you post, follow, and are followed. I build it alone, unfunded, the
          same way I build everything else, because I think the parts of your
          life that matter most deserve the same guarantee I insist on
          everywhere: verifiable, not trusted; yours, not rented.
        </p>
        <p>
          If any of this actually landed — not agreed with abstractly, but
          landed — the npub above is how you tell me. A zap costs you almost
          nothing, and it tells me, concretely, that building this alone was
          worth it.
        </p>
      </div>
    </div>
  )
}
