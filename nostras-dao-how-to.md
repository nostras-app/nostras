# NOSTRAS Community DAOs — Feature Guide

Oct 10, 2026 · @Mauro

## Overview

Any NOSTRAS community (a NIP-29 group) can switch on DAO mode: admins open Yes/No proposals, members vote, and NOSTRAS publishes a verifiable result. The feature shipped in three pieces on 2026-09-26: relay gating, the DVM tally, and the client UI.

The design rests on four decisions:

- **Non-custodial treasury.** The group's money stays in the owner's own wallet. NOSTRAS never holds DAO funds; a passed spending proposal is a mandate the owner pays out by hand.
- **One member, one vote.** No token weighting. Eligible voters are the group's admins and members.
- **Admins propose, members vote.** Only admins can open a proposal; every admin and member can vote on it.
- **Pay per proposal.** NOSTRAS charges a flat 21 sats to register a proposal. Voting is free.

Everything is built on standard Nostr events (NIP-29 groups, NIP-88 polls, NIP-32 labels, NIP-90 DVM jobs), so anyone can recount a result from the public votes.

Proposal lifecycle (6 states):

```
Awaiting registration --admin pays 21 sats--> Open (voting) --endsAt + 10 s--> Counting
Counting --quorum met, Yes over threshold--> Passed --owner pays payee, marks executed--> Executed
Counting --quorum missed or Yes not over threshold--> Rejected
```

Each box is a status shown on the proposal card; Executed applies only to passed proposals that request an amount.

## Turning DAO mode on

A group admin turns DAO mode on from the group's admin panel (the gear icon in the chat header). No other setup is needed.

1. Open the community, click the gear, tick **DAO mode (members vote on proposals)**, and click **Save DAO mode**.
2. Add voters with **Add member**. This publishes a NIP-29 kind:9000 grant with the `member` role, so the person can vote without becoming an admin.
3. The group now shows a **Chat | Proposals** switch for everyone.

DAO mode is stored as a bare `["dao"]` tag on the group's kind:9002 edit-metadata event. Every admin edit republishes the full group state (name, about, paid-joining price and payout, DAO flag), so renaming a group never silently switches DAO mode or a paywall off.

DAO mode combines with paid joining: a group can charge to post *and* vote on proposals. Unlike paid joining, the DVM's community key does not need to be promoted to admin for DAO mode.

## Proposals

A proposal is a Yes/No question an admin publishes from the Proposals tab, with a voting window and two pass rules. It is a NIP-88 poll (kind:1068) carrying the group's `h` tag plus a few governance tags.

| Field | Composer default | What it means |
| --- | --- | --- |
| Question | (required) | The proposal text, stored as the poll content |
| Voting window | 1 day (options: 1 hour, 1 day, 3 days, 7 days) | Sets `endsAt`; votes after it don't count |
| Quorum | 50% | Minimum share of eligible voters who must vote |
| Threshold | 50% | Share of Yes votes that must be *exceeded* to pass (100% = unanimous) |
| Amount (optional) | empty | Sats requested for a spending proposal |
| Payee (optional) | empty | Who should receive the payout |

The client always publishes options `yes` and `no` with `["approve", "yes"]`, single-choice. The relay requires every DAO proposal to be single-choice with an `approve` tag naming a real option, so the threshold has a defined option to measure.

After publishing, a proposal shows as **Awaiting registration** until an admin pays the 21-sat fee (next sections).

## Voting

Admins and members vote Yes or No on an open proposal from its card; non-members see the proposal but no vote buttons. A vote is a NIP-88 response (kind:1018) that always carries the group's `h` tag.

The tally applies four rules:

- **Membership snapshot.** Only people who were admins or members when the proposal was created count. Someone added mid-vote can vote, but their vote isn't counted.
- **Latest vote wins.** A voter can change their mind; only their last vote before `endsAt` counts.
- **Deadline.** Votes timestamped after `endsAt` are ignored.
- **Only gated votes count.** A vote without the group's `h` tag is an ordinary NIP-88 response the relay can't gate, so the tally ignores it.

While voting is open, each card shows live counts marked *live, unofficial*. The official result comes only from the DVM's label.

DAO proposals can also appear in the home feed, since it shows polls. There they render as a non-votable **Community proposal** card with an "Open in its community" link, so nobody casts a plain vote that would silently not count.

## Registration and the official tally

A proposal becomes official when an admin pays NOSTRAS's 21-sat fee; the DVM then counts the votes at the deadline and publishes the result. Both steps run in NOSTRAS's DVM as NIP-90 job **5909 → 6909**.

**Registration.** The admin clicks Register on an "Awaiting registration" card. The DVM checks that the proposal is well formed, voting hasn't ended, the group is in DAO mode, the requester is a current admin, and the proposal isn't already registered. It then issues a 21-sat Lightning invoice; the admin pays it (copy the invoice, or pay with a connected NWC wallet). On settlement the DVM publishes an `open` label and a 6909 `registered` result.

**Tally.** Ten seconds after `endsAt` the DVM counts the votes using the rules above:

- Quorum is met when voters ÷ eligible ≥ quorum.
- The proposal passes when quorum is met and Yes ÷ voters > threshold.

It then publishes a `passed` or `rejected` label whose content is JSON with every count (eligible, voted, per-option counts, quorum met, Yes share), so anyone can recount from the public votes. The card switches from live counts to the official result.

**Survives restarts.** On every start and reconnect the DVM rescans for `open` labels with no result yet and re-arms their timers from relay data alone, with a guard against scheduling the same tally twice.

All labels are NIP-32 (kind:1985) in the `org.nostras.dao` namespace, signed by the DVM's persisted community key. The client only trusts `open`/`passed`/`rejected` labels from that key, because anyone can publish a label.

## Executing a passed spending proposal

When a spending proposal passes, the owner pays the payee from their own wallet and then records it with **Mark executed**. NOSTRAS never moves treasury money.

1. A passed proposal with an amount shows a **Mark executed** button to admins.
2. The admin pays the payee by hand, outside NOSTRAS.
3. They paste a payment proof (a Lightning preimage or a zap receipt id) and confirm.
4. The client publishes an `executed` label signed by the admin, carrying the proof. The card flips to **Executed**.

The client only trusts `executed` labels from a current admin; labels from anyone else are ignored.

**Trust model.** A money vote is a trusted mandate, not an enforced transfer. Members trust the owner to honor a passed proposal; the public `executed` label and its proof make that honoring (or its absence) visible to everyone. The admin panel states this in plain words when DAO mode is turned on.

## Relay enforcement and protections

NOSTRAS's own relay refuses DAO events from the wrong people before they're stored; the DVM and client add the checks the relay can't do cheaply.

| Check | Where | Rejected with |
| --- | --- | --- |
| Proposal from a non-admin | Relay | "only DAO admins can open proposals" |
| Vote from a non-member | Relay | "only DAO members can vote" |
| Quorum or threshold outside (0, 1] | Relay | invalid proposal |
| `endsAt` missing or not after `created_at` | Relay | invalid proposal |
| Multiple-choice proposal, or `approve` naming no option | Relay | invalid proposal |
| Duplicate `h` tags | Relay | refused (fails closed) |
| Registration by a non-admin, after the deadline, or twice | DVM | job error |
| Forged `passed`/`rejected`/`executed` labels | Client | ignored (wrong signer) |

Polls in groups without DAO mode, and polls with no group, behave exactly as before. Admin and member status is derived by replaying the group's kind:9007/9000/9001 history, identically on the relay, the DVM and the client, so the three never disagree about who can vote. All DAO reads and writes stay on NOSTRAS's own relay, the only one that enforces these rules.

## Protocol reference

Every DAO action is a standard Nostr event; the table lists each kind and the tags that matter.

| Kind | NIP | Signed by | Purpose | Key tags |
| --- | --- | --- | --- | --- |
| 9002 | 29 | Admin | Turn DAO mode on/off (full group state) | `h`, `dao`, plus `restricted`/price/payout if set |
| 9000 | 29 | Admin | Add a voter | `h`, `p` with role `member` |
| 1068 | 88 | Admin | Proposal | `h`, `option` yes/no, `polltype` singlechoice, `approve`, `quorum`, `threshold`, `endsAt`, `relay`; optional `amount`, `payee` |
| 1018 | 88 | Admin or member | Vote | `e` (proposal), `h`, `response` |
| 5909 | 90 | Admin | Registration request | `i` = proposal id |
| 7000 | 90 | DVM | Payment required / status | `amount` (21 sats invoice) |
| 6909 | 90 | DVM | Registration result | `registered` |
| 1985 | 32 | DVM community key | `open`, `passed`, `rejected` labels | `L`/`l` = `org.nostras.dao`, `e`, `h`; tally JSON in content |
| 1985 | 32 | Admin | `executed` label | `L`/`l`, `e`, `h`, `proof` |

The DVM advertises job 5909 in its NIP-89 handler announcement (kind:31990, `k=5909`).

## Status and known limitations

All three pieces are live in production since 2026-09-26 and were verified end to end against a local relay and DVM; they have not yet been exercised on production with a real DAO or a real paid registration.

- **Payouts are manual.** Passing a spending proposal doesn't move money; the owner pays and marks it executed.
- **Yes/No only in the UI.** The convention allows any single-choice option set, but the composer always publishes Yes/No.
- **NOSTRAS relay only.** Proposals, votes and labels live on NOSTRAS's own relay; other relays don't enforce DAO rules.
- **Not interoperable yet.** Other Nostr clients see a proposal as an ordinary poll at best; the governance tags are a NOSTRAS convention.
- **Paid registration not live-tested.** It uses the same payment path as every other DVM job, but free mode skipped it during verification.
- **Same-second edits.** Two kind:9002 group edits in the same second replay in undefined order on relay boot (rare, pre-existing).
