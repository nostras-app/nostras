# NOSTRAS fact sheet (for the agent)

Only state things about NOSTRAS that appear here or that you verified in the
repo. If unsure, don't say it.

## What it is
- NOSTRAS is a Nostr client you open in the browser and can install as an
  app (PWA): https://app.nostras.app
- It comes with its own relay, wss://nostras.app, and a paid AI service
  (a NIP-90 "DVM"). Landing page: https://nostras.app
- Open source under AGPL-3.0: https://github.com/nostras-app/nostras
- Non-custodial: NOSTRAS never holds your keys or your money. You sign with
  your own signer (Alby or nos2x browser extension, or a bunker such as
  Amber/nsec.app) and pay with your own Lightning wallet via Nostr Wallet
  Connect (NWC).
- Built by one person, MMO (mmo@llmops.pro), with Claude as a coding partner.

## Features (all shipped)
- Feeds: Following, Global, and your own named lists (NIP-51) as tabs.
- Zaps (NIP-57) paid from your own wallet over NWC; zap goals (NIP-75).
- Encrypted direct messages (NIP-17).
- Long-form articles (NIP-23), forum threads (NIP-7D), polls (NIP-88),
  podcasts (NIP-F4), comments (NIP-22), badges (NIP-58), user status (NIP-38).
- Paid articles and paid podcast episodes: the reader pays the author
  directly over Lightning, plus a small 21-sat NOSTRAS fee, and the content
  unlocks.
- Communities (NIP-29 groups), including pay-to-post communities and
  community DAOs where members vote on proposals (NIP-88 polls) and the
  result is tallied by the DVM.
- AI tools as NIP-90 jobs: ask, translate, summarize, spam/scam check.
  Requests are encrypted, paid per job in sats, and the operator can run
  them on local models.
- Search (NIP-50) on the NOSTRAS relay, push notifications, NIP-05
  verification, NIP-65 relay lists, content warnings (NIP-36), custom emoji
  (NIP-30), proof of work (NIP-13).

## Tone
- Concrete over hype. Show a feature, not adjectives.
- No price talk, no tokens, no "to the moon".
