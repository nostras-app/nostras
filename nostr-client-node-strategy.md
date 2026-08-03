# Nostr PWA Client + Node Strategy

## Why

- Nostr is an open, relay-based decentralized protocol: identity = keypair, no
  platform lock-in, censorship resistance via multi-relay redundancy.
- Goal: build a Nostr **client** that anyone can install on desktop, laptop,
  or mobile (any OS) without going through the Apple/Google app store review
  and distribution process.
- In parallel, run a Nostr **node (relay)** that the client talks to by
  default, giving the added value (see below) that makes users prefer this
  client over a generic one — while still respecting the protocol norm that
  users can point their client at any relay they choose.
- Differentiation strategy: deliver "special services" through the node, but
  implement them as **protocol-native NIPs** wherever possible rather than
  proprietary APIs. This keeps the client/node interoperable with the rest of
  the Nostr network and avoids quietly rebuilding a centralized silo.

## How

### Distribution: PWA
- A Progressive Web App sidesteps app-store review/approval entirely.
- Installable via "Add to Home Screen" / browser install prompt on Android
  and desktop Chrome/Edge; iOS Safari (16.4+) also supports installable PWAs,
  though iOS is stricter (limited background execution, push notifications
  historically limited).
- Client responsibilities: non-custodial key handling, outbound WebSocket
  connections to relays, local event cache (IndexedDB), UI/UX. All of this
  works near-identically across desktop and mobile — device compute power is
  not a constraint here.

### The "node" half: why it can't just live in the PWA
- Browsers cannot accept inbound network connections, and mobile OSes
  (iOS especially) suspend background service workers — so a PWA cannot be a
  publicly reachable relay the way a server can.
- Conclusion: the relay/node must be a real always-on server (self-hosted or
  cloud), separate from the client's runtime. The client connects to it (and
  to other relays) the same way it connects to anyone else's relay.
- This is actually convenient: the relay's uptime is decoupled from whether
  any given client instance is open.

### Control narrative
- Non-custodial keys (client) + self-hosted relay (node) together mean the
  user's identity and default data store are both under their own control —
  not a third party's.
- Relay choice stays open (NIP-65 relay lists): the client defaults to the
  operator's node but lets users add/swap relays, preserving Nostr's
  censorship-resistance property instead of re-centralizing "with extra
  steps."

## Brainstormed added-value services, mapped to NIPs

**Identity & Signing**
| NIP | Defines | Service opportunity |
|---|---|---|
| NIP-05 | DNS-based verified identifiers | `name@yourdomain.com` handles |
| NIP-39 | External identity proofs | Cross-platform verification/badges |
| NIP-46 | Remote signing ("bunker") | Mobile-friendly signer service, no local `nsec` |
| NIP-98 | HTTP auth via Nostr keys | Auth backend for your own services |

**Messaging & Privacy**
| NIP | Defines | Service opportunity |
|---|---|---|
| NIP-17 / NIP-59 | Private DMs via gift-wrap | Relay tuned for private delivery |
| NIP-44 | Modern encryption payloads | Baseline for any private feature |
| NIP-40 | Event expiration | Ephemeral/"stories" content |

**Discovery & Performance**
| NIP | Defines | Service opportunity |
|---|---|---|
| NIP-50 | Search | Full-text search (rare among public relays) |
| NIP-45 | COUNT command | Cheap analytics without bulk download |
| NIP-65 | Relay list metadata (outbox model) | Aggregator/proxy relay, saves mobile battery/data |
| NIP-11 | Relay info document | Publish capabilities/pricing/ToS |

**Community & Moderation**
| NIP | Defines | Service opportunity |
|---|---|---|
| NIP-29 | Relay-based groups | Hosted communities with moderation |
| NIP-72 | Moderated communities | Topic-based communities |
| NIP-32 | Labeling | Content labeling for moderation/curation |
| NIP-56 | Reporting | Trust & safety pipeline |
| NIP-51 | Lists (mute/bookmark/curated) | Server-assisted list sync |

**Payments**
| NIP | Defines | Service opportunity |
|---|---|---|
| NIP-57 | Zaps | Integrated Lightning tipping |
| NIP-47 | Nostr Wallet Connect | Non-custodial wallet connection |
| NIP-13 | Proof of work | Freemium lever (PoW-gated free tier) |
| NIP-42 | Relay authentication | Gate premium/paid access |

**Media & Content**
| NIP | Defines | Service opportunity |
|---|---|---|
| NIP-94 / NIP-96 | File metadata / HTTP storage | Bundled media hosting |
| NIP-92 | Media attachments | Rich embeds |
| NIP-23 | Long-form content | Blogging/publishing platform |
| NIP-58 | Badges | Gamification/achievements |

**Compute & Sync**
| NIP | Defines | Service opportunity |
|---|---|---|
| NIP-90 | Data Vending Machines | Sell AI/compute jobs over Nostr itself |
| NIP-78 | Arbitrary app data | Encrypted cross-device settings sync |

## Initial priority ranking

1. NIP-46 signer service (solves mobile key-management pain)
2. Push notifications (transport-level, not itself a NIP — needed because PWAs can't hold background connections open)
3. NIP-65 aggregation/outbox proxy (battery/data efficiency, single-connection UX)
4. NIP-50 search (rare feature among public relays)
5. NIP-57 / NIP-47 zaps & wallet connect (monetization + core Nostr social feature)
6. NIP-90 Data Vending Machines (longer-term compute marketplace / monetization)

## Deep dives

Detailed breakdowns of each priority item: what it is, why it fits the
strategy, the implementation shape, and the main tradeoff/risk.

### NIP-90 — Data Vending Machines (DVMs)

**Core idea**: a marketplace protocol for on-demand compute, built entirely
out of Nostr events. A client publishes a "job request" event (kind
`5000`–`5999`, one range per job type), any number of DVM providers listen
for requests they can fulfill, do the work, and publish a "job result" event
(kind `6000`–`6999`) back — optionally after a paid Lightning invoice (via
zaps) is settled. Kind `7000` carries job feedback/status (processing,
payment-required, error, success).

**Flow**:
1. Client publishes `kind:5xxx` — e.g. "translate this text to Spanish,"
   "transcribe this audio," "summarize this URL" — tagged with input data
   and params.
2. Your DVM (server-side, subscribed to relevant job kinds on your relay
   and/or the wider network) picks it up.
3. DVM does the work (calls an LLM, runs a model, hits an API).
4. DVM optionally publishes `kind:7000` "payment-required" with a Lightning
   invoice (NIP-57 zap or plain bolt11).
5. Once paid, DVM publishes `kind:6xxx` with the result, referencing the
   original request.

**Why it fits**: monetizable, fully protocol-native (a generic Nostr client
could discover and pay for your DVM services without using your client at
all — good marketing surface), and turns "my node does something extra"
into a revenue line rather than just a UX nicety.

**Realistic job types to start with**: text summarization, translation,
transcription (audio→text), content moderation/classification, image
generation, "for you" feed ranking/recommendation, and search (could even
implement NIP-50 search *as* a DVM rather than a raw relay extension — more
portable).

**Implementation shape**: a backend worker service (separate from the relay,
though it can share infrastructure) that:
- Subscribes to `kind:5xxx` events (filtered to supported job types) on your
  own relay, and optionally on public relays to source cross-network
  business.
- Runs the job (likely calling an LLM API or a local model).
- Handles payment via a Lightning node/NWC before releasing results for
  paid tiers.
- Publishes `6xxx`/`7000` responses back.

**Main tradeoff**: DVM discovery today is thin — no dominant marketplace UI
yet, so demand mostly comes from your own client surfacing "ask the DVM"
actions in the UI (e.g. a "summarize this thread" button that fires a
`kind:5000` event under the hood). Early days: first-mover positioning is
plausible, but you're partly building the demand-side UX, not just the
supply-side service.

### NIP-46 — Remote signing ("bunker")

**Core idea**: instead of the app holding the user's `nsec` directly, the
private key lives in a separate signer (could be a phone-resident signer
app, a browser extension, or a hosted "bunker" service). The client sends
signing *requests* (encrypted Nostr events, kind `24133`) to the signer over
relays; the signer approves/signs and sends the result back. The client
never sees the raw private key.

**Why it matters especially for mobile/PWA**: a PWA has no secure enclave
equivalent and no OS keychain integration by default, so storing `nsec`
directly in browser storage is the weakest link in the whole system. NIP-46
lets you offer a "bunker" signer as part of your node — the key can be
generated and held in a hardened service you run (with the user's explicit
custody tradeoff understood), or the user can run their own signer (e.g.
Amber on Android) and just point any NIP-46-compatible client at it.

**Connection flow**: either the client generates a `nostrconnect://` URI and
the signer scans/approves it, or the user pastes a `bunker://` URI from
their signer into the client. After that, every signing operation is a
request/response pair of encrypted events relayed between client and
signer — the client stays "logged in" without ever holding the key.

**Implementation shape**:
- A signer service (could be self-hosted per-user, or a multi-tenant bunker
  you operate) that holds keys and exposes the NIP-46 request/response
  protocol over your relay.
- Client-side: NIP-46 connector logic (several existing libraries implement
  this, e.g. `nostr-tools`'s NIP-46 helpers) so the PWA can act as either
  initiator or acceptor of a `bunker://`/`nostrconnect://` session.
- Decide explicitly whether you ever hold key material server-side
  (custodial bunker, convenient but a trust/liability commitment) vs. only
  supporting bring-your-own-signer (fully non-custodial, less friction-free
  for mainstream users).

**Main tradeoff**: running a custodial bunker reintroduces the exact
custody risk Nostr is designed to avoid — you become a target and a point
of trust. The safer protocol-native play is to support NIP-46 as a
*client capability* (works with Amber, other bunkers, etc.) and only
consider hosting your own signer as an explicit, clearly-labeled
convenience tier.

### Push notifications (transport-level, not a NIP)

**Core idea**: not part of the Nostr spec itself, but the missing piece
that makes a PWA feel like a native app. Since a PWA can't hold a
background WebSocket open reliably (iOS suspends service workers
aggressively; Android is less strict but still not guaranteed), the node
needs to actively wake the client when something relevant happens
(mention, DM, zap, reaction).

**Flow**:
1. On install/first use, the PWA registers a Web Push subscription
   (browser-native API) and associates it with the user's pubkey on your
   backend — this mapping is the one piece of infrastructure that has to
   live outside the Nostr protocol itself, since relays have no concept of
   push endpoints.
2. Your relay/node watches the event stream for events that reference the
   user's pubkey (mentions, replies, DMs, zaps, reactions).
3. On a match, your backend sends a Web Push message, which the OS
   delivers to the device (even if the PWA isn't open), triggering a
   service worker to show a notification.

**Implementation shape**: standard Web Push (VAPID keys, `Push API` +
`Notifications API` in the service worker) — no Nostr-specific tooling
needed for the transport, but the *trigger logic* (deciding what's
notification-worthy) is naturally something your relay is best positioned
to do since it already sees the full event stream for that user.

**Main tradeoff / privacy note**: to know when to notify a user, your
backend needs to inspect their incoming events (or at least metadata like
tags), which is more visibility into a user's activity than a relay
strictly needs for storage/serving. Worth being explicit in your privacy
policy about what's inspected purely for notification triggering vs.
stored. Also: iOS Web Push requires the PWA to be installed
("Add to Home Screen") first — it won't work from a plain browser tab.

### NIP-65 — Relay list metadata (outbox model) / aggregation proxy

**Core idea**: NIP-65 defines a `kind:10002` event where a user publishes
which relays they *write* to and which they *read* from. This lets other
clients find a user's content without guessing — you look up their
`kind:10002` event (from any relay), then fetch their posts from their
declared write relays, and check their declared read relays when you want
them to see something you publish (like a reply or mention).

**Why it's a real service opportunity**: properly following the outbox
model means a client might need to open connections to dozens of relays to
build one coherent feed (every followed user could write to a different
set of relays). That's expensive on mobile — more battery, more radio
usage, more connection overhead. An aggregator node solves this: your
relay/node reads each followed user's `kind:10002` list, fans out the
actual queries to their relays server-side, merges results, and the PWA
client only ever needs *one* WebSocket connection (to you) to get a
complete, properly-sourced feed.

**Implementation shape**:
- A backend aggregation service that maintains outbox-model relay maps for
  the pubkeys your users follow (cache `kind:10002` events, refresh
  periodically).
- A fan-out query layer that, given a client's `REQ` filter (e.g. "posts
  from my follows"), resolves to the right set of upstream relays,
  queries them concurrently, deduplicates, and streams results back over
  the single client connection.
- Should be transparent/optional: a client that wants to do outbox-model
  fetching itself (e.g. when directly connected to other relays too)
  should still be able to; this is a convenience layer, not a requirement.

**Main tradeoff**: this makes your node a more central piece of the user's
experience (single point of query aggregation), which cuts slightly against
pure decentralization — mitigate by keeping it swappable (any other relay
implementing the same aggregation approach works identically, and the
client can always fall back to querying relays directly).

### NIP-50 — Search

**Core idea**: defines a `search` field in the relay `REQ` filter for
full-text search, e.g. `{"kinds":[1],"search":"bitcoin lightning"}`. Support
is optional and inconsistent — most public relays don't implement it, or
implement a shallow version.

**Why it's a real gap**: without NIP-50, "search" in most Nostr clients
today either doesn't exist or only searches locally-cached events the
client has already seen — which is a small, arbitrary slice of the network.
A relay/node with real full-text indexing gives users search that actually
covers the wider network (or at least everything routed through your
aggregation layer if paired with the NIP-65 service above).

**Implementation shape**:
- Store incoming events in a full-text-indexed store (Postgres with
  `tsvector`/`pg_trgm`, or a dedicated search engine like Meilisearch/
  Typesense/Elasticsearch sitting alongside your primary event store).
  Several existing relay implementations (e.g. `strfry` with a search
  plugin, or `khatru`-based relays) already have plug-in points for this.
  (Worth verifying current library support at build time — this space
  moves fast.)
- Expose the `search` filter field per NIP-50 in your relay's `REQ`
  handling, translating it into the underlying search backend's query.
- Decide search scope: only content stored on your relay, vs. combined with
  the aggregation layer (search across your users' full outbox-model
  network) — the latter is more valuable but couples this feature to the
  NIP-65 service.

**Main tradeoff**: indexing and serving full-text search at scale is the
most infrastructure-heavy item on this list relative to its novelty (it's
a "should just work" feature users expect, not a flashy differentiator) —
good for retention, less useful as headline marketing.

### NIP-57 / NIP-47 — Zaps & Nostr Wallet Connect

**Core idea**: NIP-57 defines "zaps" — Lightning Network micropayments
attached to Nostr events (kind `9734` zap request, kind `9735` zap receipt),
the de facto tipping mechanism in the Nostr ecosystem. NIP-47 (Nostr Wallet
Connect / NWC) defines how a client can control a *remote* Lightning
wallet non-custodially — the client sends signed requests (pay invoice, get
balance) over Nostr to the wallet service, without ever holding the
wallet's keys. (The `damus_on_iphone_subwallet.txt` file already in this
project directory is an example NWC connection string from Alby — note it's
a live secret and shouldn't be committed/shared as-is.)

**Why it fits**: zaps are already a core social primitive in Nostr (likes
with money attached), so supporting them well isn't optional if you want
a competitive client. NWC integration is what makes zapping frictionless —
without it, users have to manually copy invoices between apps.

**Implementation shape**:
- Client-side: NIP-57 zap request/receipt handling (construct zap requests,
  render zap receipts as "amount paid" on posts) and a NIP-47 (NWC)
  connection flow so users can paste/scan a wallet connect string (like the
  Alby one already in this project) and zap directly from the client.
- Node-side value-add: you don't need to run a Lightning node yourself to
  support zaps (any NWC-compatible wallet works), but you *could* offer a
  bundled custodial or semi-custodial wallet as a convenience tier for
  users who don't want to set up their own — similar custody tradeoff
  discussion as the NIP-46 bunker above.
- Zap receipts need to be validated (check the receipt's signature comes
  from the zapped user's declared LNURL provider) to avoid fake zap
  displays — a real implementation detail, not just UI.

**Main tradeoff**: same custody question as NIP-46 — bundling a wallet is
the highest-friction-removal option but the highest trust/liability
commitment; defaulting to "bring your own NWC-compatible wallet" (Alby,
Mutiny, etc.) keeps you protocol-native and off the hook for custody, at
the cost of a small onboarding step for new users.

---

## Build roadmap (MVP first)

Ordering logic: ship a baseline client+node with no differentiation first
(prove the core loop works end-to-end), then layer services roughly by
*(mobile UX pain solved) / (infra cost)* — cheapest, most-felt wins before
heavier infrastructure, and defer anything that requires a custody decision
until the product has real users to justify the liability conversation.

### Phase 0 — MVP: baseline client + node parity

Goal: something installable, on your own infrastructure end-to-end, that
does what any decent Nostr client does — no differentiation yet, just proof
the foundation works.

- **PWA client**: key generation/import, installable manifest + service
  worker (works on desktop, Android, iOS 16.4+), local event cache
  (IndexedDB), compose/read/react (kinds 0, 1, 3, 7), connect to multiple
  relays including your own by default, read (not yet aggregate) NIP-65
  relay lists so posts resolve correctly.
- **Relay/node**: deploy existing open-source relay software rather than
  building one from scratch (e.g. `strfry`, `khatru`, `nostr-rs-relay`) with
  NIP-01 (base protocol) and NIP-11 (relay info document) support, running
  always-on (self-hosted or cloud VM).
- **Exit criterion**: you can install the PWA on a phone and a laptop, post,
  follow, and see updates, entirely through infrastructure you control.

### Phase 1 — Security & mobile UX baseline

Goal: fix the two things that most hurt a browser-based client specifically,
before real user keys/money are at stake. Both are mostly client-side
library work, not heavy infra.

- **NIP-46 (bring-your-own-signer)**: support connecting to external
  signers (e.g. Amber on Android) so users aren't forced to keep `nsec` in
  browser storage. Ship this *before* growing a user base, since migrating
  people off insecure key storage later is much harder than starting right.
- **Push notifications**: Web Push registration mapped to pubkey, backend
  watches the event stream for mentions/DMs/zaps/reactions and triggers
  notifications. This is what makes the PWA feel native on mobile — highest
  perceived-quality win for moderate effort.
- **Basic zap support (NIP-57 + NIP-47, bring-your-own-wallet)**: display
  zap receipts, send zaps via a pasted/scanned NWC string (Alby, Mutiny,
  etc.) — no wallet custody required yet, but zaps are expected baseline
  functionality in any competitive Nostr client.

### Phase 2 — Performance & retention differentiation

Goal: infra-heavier features that make the client meaningfully better once
there's a real follow-graph and usage to benefit from them.

- **NIP-65 outbox aggregation proxy**: cache followed users' relay lists,
  fan out queries server-side, serve clients a single unified connection.
  Biggest mobile battery/data win, but only pays off once users have enough
  follows scattered across enough relays to matter.
- **NIP-50 search**: full-text indexing (e.g. Postgres `tsvector`, or
  Meilisearch/Typesense alongside the event store) exposed via the `search`
  filter field. Natural to build alongside the aggregation layer since both
  touch the same event-indexing pipeline.

### Phase 3 — Monetization & growth

Goal: revenue-generating and headline-differentiating features, deferred
until the base product has traction and the custody/legal questions below
have been deliberately decided (not defaulted into).

- **NIP-90 DVMs**: start with one or two job types (e.g. text summarization
  or transcription) as a proof of concept surfaced directly in client UI
  (a "summarize this thread" button), expand based on uptake.
- **Optional custodial convenience tiers**: hosted NIP-46 bunker and/or a
  bundled Lightning wallet for users who don't want to self-manage keys or
  wallets. Explicitly gated on deciding the custody/liability stance first
  — not a default, and should be clearly labeled as a different trust tier
  from the rest of the product.

### Decision gates between phases

- After Phase 0: does the core loop (install → post → follow → read) work
  smoothly enough on all target platforms to justify investing further?
- After Phase 1: is retention/engagement good enough to justify the
  infra cost of Phase 2's aggregation + search build-out?
- Before Phase 3's custodial tiers: explicit legal/liability review — this
  is a business decision, not just an engineering one.

## Decisions log

### App name: NOSTRAS (decided)

**Choice**: the client app is named **NOSTRAS**. Used as the npm package
name (`nostras`), the PWA display name (manifest `name`/`short_name`), and
the `index.html` title.

**Status**: confirmed by user (2026-08-03).

### Relay software: khatru (decided)

**Choice**: build the relay on [khatru](https://github.com/fiatjaf/khatru)
(Go relay framework) rather than a pre-built binary like `strfry` or
`nostr-rs-relay`.

**Why**: khatru is a library you write your relay as code with, not a
binary you configure — and Phase 2 (NIP-65 outbox aggregation, NIP-50
search) both require intercepting and rewriting incoming `REQ` filters
before they hit storage (fan a single client query out to many upstream
relays; route `search` filters to a full-text index). That's khatru's
design center — pluggable filter/query handling and storage backends.
Built/maintained by fiatjaf, a core Nostr protocol author, so NIP coverage
tends to stay current.

**Alternative considered**: `strfry` (C++) is the more battle-tested,
higher-raw-throughput option and remains a fallback if ops simplicity at
scale becomes more important than customization ease — but it would need a
separate proxy layer in front of it to do the Phase 2 filter interception,
since you're not meant to modify the binary directly. Push-notification
triggers and the DVM worker (Phase 1/3) would work fine against either
choice, since those only need to subscribe like a regular client.

**Status**: confirmed by user (2026-08-03) — locked in for Phase 0 build-out.

### Custody stance: bring-your-own, permanently (decided, final)

**Choice**: stay non-custodial on both fronts, permanently — no
hosted/backend bunker, no bundled wallet, no revisit trigger. The PWA
implements the *client* side of NIP-46 and NIP-47 only, connecting out to
whatever signer (e.g. Amber) or wallet (e.g. Alby, Mutiny) the user already
has or sets up themselves. No backend signer or wallet infrastructure
exists or is planned.

**Why**: originally deferred pending a legal/liability review of custody
risk. On review, there's nothing to resolve: as built, NOSTRAS never holds
custody of anyone else's keys or funds anywhere in the system —

- **Client zapping**: the user's own wallet (their own NWC connection)
  pays directly; funds never pass through NOSTRAS.
- **DVM payments** (`server/cmd/dvm`): the DVM operator receives payment
  *for a service it renders*, into its own wallet — ordinary
  Lightning-accepting commerce, not custody of someone else's money. This
  was never the thing the legal gate was about, and shouldn't be confused
  with it.

The only thing ever gated was the *hypothetical* optional convenience
tier — hosting a bunker or wallet *on behalf of users* who don't want to
self-manage. That was never built. The custody question resolves by simply
never building it, not by obtaining a legal opinion on a system that holds
no custody. If a future version of NOSTRAS ever did add a flow where funds
or keys pass through or are held by the server — even momentarily (e.g.
escrow, a hosted bunker signing on a user's behalf) — that would
reintroduce real custody risk and require this decision to be reopened
with actual legal counsel at that time. Nothing currently planned does
that.

**Status**: confirmed by user (2026-08-04) as final. Not gated on further
review; no revisit trigger unless the architecture itself changes to
introduce real custody.

## Next steps

- Phase 0 tech stack for the PWA client: framework choice, key storage
  approach, service worker/install setup.

---
*This document is a running log of strategy discussion, not an implementation
spec. Update it as decisions are made.*
