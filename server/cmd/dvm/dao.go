package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

// Community DAOs, Piece 2 (2026-09-26) — proposal registration + tally.
// See nostr-client-node-strategy.md's "Community DAOs" section for the
// full design and the decisions behind it.
//
// server/nip29.go (Piece 1) already enforces who may write: in a group
// with DAO mode on, only admins can publish a proposal (a NIP-88
// kind:1068 poll with the group's "h" tag plus quorum/threshold/approve/
// endsAt tags) and only admins/members can vote (kind:1018 with the "h"
// tag). What the relay can't do is see a Lightning payment or count
// votes cheaply on its hot path — that's this job.
//
// Registration (kind:5909, ["i", <proposal id>, "event"]) is what the
// NOSTRAS per-proposal fee pays for: a proposal isn't "official" (shown
// as open, tallied, listed in the DAO ledger) until the DVM publishes an
// "open" label for it. At endsAt the DVM counts votes and publishes a
// "passed"/"rejected" label. Both labels are NIP-32 (kind:1985) in the
// org.nostras.dao namespace, signed by the persisted community key — the
// same key paid communities already promote to admin, so it's a stable,
// already-trusted identity. Anyone can recount from the public votes;
// the label is a convenience and a record, not the only source of truth.
const (
	kindJobRequestDaoProposal = 5909
	kindJobResultDaoProposal  = 6909

	kindPoll         = 1068
	kindPollResponse = 1018

	daoLabelNamespace  = "org.nostras.dao"
	daoProposalFeeSats = 21

	// Small delay after endsAt before tallying, so a vote published in the
	// final second has time to actually land on the relay.
	daoTallyGrace = 10 * time.Second
)

// daoTallyScheduled dedupes tally timers per proposal id. runDVM runs
// again on every reconnect and each run rescans for pending tallies, so
// without this a proposal could get two timers (and two result labels).
var (
	daoTallyMu        sync.Mutex
	daoTallyScheduled = map[string]bool{}
)

// daoProposal is the parsed governance convention on top of a NIP-88 poll.
type daoProposal struct {
	evt       *nostr.Event
	groupID   string
	quorum    float64
	threshold float64
	approve   string
	endsAt    int64
	options   map[string]bool
}

func parseDaoProposal(evt *nostr.Event) (*daoProposal, error) {
	if evt.Kind != kindPoll {
		return nil, fmt.Errorf("that event isn't a poll")
	}
	hTag := evt.Tags.Find("h")
	if len(hTag) < 2 || hTag[1] == "" {
		return nil, fmt.Errorf("that poll isn't attached to a group")
	}
	p := &daoProposal{evt: evt, groupID: hTag[1], options: map[string]bool{}}
	for _, tag := range evt.Tags {
		if len(tag) >= 2 && tag[0] == "option" {
			p.options[tag[1]] = true
		}
	}
	var err error
	if p.quorum, err = fractionTag(evt, "quorum"); err != nil {
		return nil, err
	}
	if p.threshold, err = fractionTag(evt, "threshold"); err != nil {
		return nil, err
	}
	approve := evt.Tags.Find("approve")
	if len(approve) < 2 || !p.options[approve[1]] {
		return nil, fmt.Errorf("proposal has no valid approve option")
	}
	p.approve = approve[1]
	endsAt := evt.Tags.Find("endsAt")
	if len(endsAt) < 2 {
		return nil, fmt.Errorf("proposal has no endsAt")
	}
	if p.endsAt, err = strconv.ParseInt(endsAt[1], 10, 64); err != nil {
		return nil, fmt.Errorf("proposal has an invalid endsAt")
	}
	return p, nil
}

func fractionTag(evt *nostr.Event, name string) (float64, error) {
	tag := evt.Tags.Find(name)
	if len(tag) < 2 {
		return 0, fmt.Errorf("proposal has no %s", name)
	}
	f, err := strconv.ParseFloat(tag[1], 64)
	if err != nil || f <= 0 || f > 1 {
		return 0, fmt.Errorf("proposal has an invalid %s", name)
	}
	return f, nil
}

// groupRoster replays a group's kind:9007/9000/9001 history up to and
// including `until` — the same history server/nip29.go's cache and the
// client's useGroupMembership replay, so all three agree. Returns the
// admin set and the eligible set (admins + members), which is what a
// DAO vote counts against. Passing the proposal's own created_at gives
// the membership snapshot: people added after the proposal opened don't
// count, so a vote can't be swung by adding members mid-vote.
func groupRoster(ctx context.Context, relay *nostr.Relay, groupID string, until nostr.Timestamp) (admins, eligible map[string]bool, err error) {
	history, err := relay.QuerySync(ctx, nostr.Filter{
		Kinds: []int{nostr.KindSimpleGroupCreateGroup, nostr.KindSimpleGroupPutUser, nostr.KindSimpleGroupRemoveUser},
		Tags:  nostr.TagMap{"h": []string{groupID}},
		Until: &until,
	})
	if err != nil {
		return nil, nil, err
	}
	sort.Slice(history, func(i, j int) bool { return history[i].CreatedAt < history[j].CreatedAt })
	admins, eligible = map[string]bool{}, map[string]bool{}
	for _, evt := range history {
		switch evt.Kind {
		case nostr.KindSimpleGroupCreateGroup:
			// First-writer-wins, matching nip29.go's createGroup.
			if len(admins) == 0 && len(eligible) == 0 {
				admins[evt.PubKey] = true
				eligible[evt.PubKey] = true
			}
		case nostr.KindSimpleGroupPutUser:
			for _, tag := range evt.Tags {
				if len(tag) < 2 || tag[0] != "p" || !nostr.IsValid32ByteHex(tag[1]) {
					continue
				}
				eligible[tag[1]] = true
				// Role-aware exactly like nip29.go's applyPutUser: an
				// explicit "member" role is member-only, anything else
				// (including no role) is admin.
				if !(len(tag) >= 3 && tag[2] == "member") {
					admins[tag[1]] = true
				}
			}
		case nostr.KindSimpleGroupRemoveUser:
			for _, tag := range evt.Tags {
				if len(tag) >= 2 && tag[0] == "p" {
					delete(admins, tag[1])
					delete(eligible, tag[1])
				}
			}
		}
	}
	return admins, eligible, nil
}

// groupIsDao reads DAO mode from the newest kind:9002 in the group — the
// same full-state directive nip29.go's cache trusts (never kind:39000).
func groupIsDao(ctx context.Context, relay *nostr.Relay, groupID string) (bool, error) {
	evts, err := relay.QuerySync(ctx, nostr.Filter{
		Kinds: []int{nostr.KindSimpleGroupEditMetadata},
		Tags:  nostr.TagMap{"h": []string{groupID}},
	})
	if err != nil {
		return false, err
	}
	var newest *nostr.Event
	for _, e := range evts {
		if newest == nil || e.CreatedAt > newest.CreatedAt {
			newest = e
		}
	}
	return newest != nil && hasTag(newest.Tags, "dao"), nil
}

// daoLabelExists reports whether the community key has already published
// a label with value `value` for this proposal.
func daoLabelExists(ctx context.Context, relay *nostr.Relay, communityKeyPk, proposalID string, values ...string) (bool, error) {
	evts, err := relay.QuerySync(ctx, nostr.Filter{
		Kinds:   []int{kindLabel},
		Authors: []string{communityKeyPk},
		Tags:    nostr.TagMap{"L": []string{daoLabelNamespace}, "l": values, "e": []string{proposalID}},
		Limit:   1,
	})
	if err != nil {
		return false, err
	}
	return len(evts) > 0, nil
}

func handleDaoProposalJob(ctx context.Context, relay *nostr.Relay, relayURL, sk, communityKeySk string, payment *paymentConfig, req *nostr.Event) {
	markJobReceived()

	communityKeyPk, err := nostr.GetPublicKey(communityKeySk)
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "DAO service is misconfigured")
		return
	}

	iTag := req.Tags.Find("i")
	if len(iTag) < 2 || !nostr.IsValid32ByteHex(iTag[1]) {
		publishFeedback(ctx, relay, sk, req, "error", `missing required i tag naming the proposal (["i", "<event-id>", "event"])`)
		return
	}
	proposalID := iTag[1]

	found, err := relay.QuerySync(ctx, nostr.Filter{IDs: []string{proposalID}, Kinds: []int{kindPoll}})
	if err != nil || len(found) == 0 {
		publishFeedback(ctx, relay, sk, req, "error", "could not find that proposal")
		return
	}
	proposal, err := parseDaoProposal(found[0])
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", err.Error())
		return
	}
	if proposal.endsAt <= int64(nostr.Now()) {
		publishFeedback(ctx, relay, sk, req, "error", "voting on this proposal has already ended")
		return
	}

	isDao, err := groupIsDao(ctx, relay, proposal.groupID)
	if err != nil || !isDao {
		publishFeedback(ctx, relay, sk, req, "error", "that group doesn't have DAO mode turned on")
		return
	}
	admins, _, err := groupRoster(ctx, relay, proposal.groupID, nostr.Now())
	if err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "could not read the group's membership")
		return
	}
	if !admins[req.PubKey] {
		publishFeedback(ctx, relay, sk, req, "error", "only a DAO admin can register a proposal")
		return
	}
	if already, err := daoLabelExists(ctx, relay, communityKeyPk, proposalID, "open"); err == nil && already {
		publishFeedback(ctx, relay, sk, req, "error", "that proposal is already registered")
		return
	}

	// NOSTRAS's per-proposal fee — the DAO infrastructure fee the owner
	// chose (see the strategy doc). Same operator wallet and
	// requirePayment flow as every other job; NOSTRAS never touches DAO
	// treasury funds, which stay in the owner's own wallet.
	if payment != nil {
		paid, err := requirePayment(ctx, relay, sk, payment, req, daoProposalFeeSats)
		if err != nil {
			publishFeedback(ctx, relay, sk, req, "error", err.Error())
			return
		}
		if !paid {
			return
		}
	}

	publishFeedback(ctx, relay, sk, req, "processing", "")

	openLabel := nostr.Event{
		Kind:      kindLabel,
		CreatedAt: nostr.Now(),
		Content:   fmt.Sprintf("Proposal registered. Voting closes at %s.", time.Unix(proposal.endsAt, 0).UTC().Format(time.RFC3339)),
		Tags: nostr.Tags{
			{"L", daoLabelNamespace},
			{"l", "open", daoLabelNamespace},
			{"e", proposalID},
			{"h", proposal.groupID},
			{"p", req.PubKey},
		},
	}
	if err := signAndPublishChecked(ctx, relay, communityKeySk, openLabel); err != nil {
		publishFeedback(ctx, relay, sk, req, "error", "payment received, but could not register the proposal ("+err.Error()+")")
		return
	}

	result := nostr.Event{
		Kind:      kindJobResultDaoProposal,
		CreatedAt: nostr.Now(),
		Content:   "registered",
		Tags:      nostr.Tags{{"e", req.ID}, {"p", req.PubKey}, {"h", proposal.groupID}},
	}
	signAndPublish(ctx, relay, sk, result)

	scheduleDaoTally(relayURL, communityKeySk, communityKeyPk, proposalID, proposal.endsAt)
}

// scheduleDaoTally arms a one-shot timer for a proposal's tally. The
// tally dials its own short relay connection when it fires, rather than
// reusing the connection that registered it — runDVM's connection can
// be torn down and replaced by a reconnect long before endsAt.
func scheduleDaoTally(relayURL, communityKeySk, communityKeyPk, proposalID string, endsAt int64) {
	daoTallyMu.Lock()
	if daoTallyScheduled[proposalID] {
		daoTallyMu.Unlock()
		return
	}
	daoTallyScheduled[proposalID] = true
	daoTallyMu.Unlock()

	wait := time.Until(time.Unix(endsAt, 0)) + daoTallyGrace
	if wait < 0 {
		wait = 0
	}
	fmt.Printf("DAO tally for %s scheduled in %s\n", proposalID[:8], wait.Round(time.Second))
	time.AfterFunc(wait, func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		err := tallyDaoProposal(ctx, relayURL, communityKeySk, communityKeyPk, proposalID)
		if err != nil {
			fmt.Printf("DAO tally for %s failed: %v\n", proposalID[:8], err)
			// Allow a later rescan (next reconnect) to retry it.
			daoTallyMu.Lock()
			delete(daoTallyScheduled, proposalID)
			daoTallyMu.Unlock()
		}
	})
}

// resumePendingDaoTallies runs on every (re)connect: any proposal with an
// "open" label but no result label gets its timer re-armed, so a DVM
// restart never drops a tally. Derived entirely from relay data, no local
// state file.
func resumePendingDaoTallies(ctx context.Context, relay *nostr.Relay, relayURL, communityKeySk, communityKeyPk string) {
	openLabels, err := relay.QuerySync(ctx, nostr.Filter{
		Kinds:   []int{kindLabel},
		Authors: []string{communityKeyPk},
		Tags:    nostr.TagMap{"L": []string{daoLabelNamespace}, "l": []string{"open"}},
	})
	if err != nil {
		fmt.Println("DAO: could not scan for pending tallies:", err)
		return
	}
	for _, label := range openLabels {
		eTag := label.Tags.Find("e")
		if len(eTag) < 2 {
			continue
		}
		proposalID := eTag[1]
		if done, err := daoLabelExists(ctx, relay, communityKeyPk, proposalID, "passed", "rejected"); err != nil || done {
			continue
		}
		found, err := relay.QuerySync(ctx, nostr.Filter{IDs: []string{proposalID}, Kinds: []int{kindPoll}})
		if err != nil || len(found) == 0 {
			continue
		}
		proposal, err := parseDaoProposal(found[0])
		if err != nil {
			continue
		}
		scheduleDaoTally(relayURL, communityKeySk, communityKeyPk, proposalID, proposal.endsAt)
	}
}

// daoTallyResult is published as the result label's JSON content, so any
// client can show the numbers without recounting (and anyone who wants to
// can recount from the public votes to check them).
type daoTallyResult struct {
	Eligible     int            `json:"eligible"`
	Voted        int            `json:"voted"`
	Counts       map[string]int `json:"counts"`
	Approve      string         `json:"approve"`
	Quorum       float64        `json:"quorum"`
	Threshold    float64        `json:"threshold"`
	QuorumMet    bool           `json:"quorumMet"`
	ApproveShare float64        `json:"approveShare"`
	Passed       bool           `json:"passed"`
}

func tallyDaoProposal(ctx context.Context, relayURL, communityKeySk, communityKeyPk, proposalID string) error {
	relay, err := nostr.RelayConnect(ctx, relayURL)
	if err != nil {
		return err
	}
	defer relay.Close()

	if done, err := daoLabelExists(ctx, relay, communityKeyPk, proposalID, "passed", "rejected"); err != nil {
		return err
	} else if done {
		return nil
	}

	found, err := relay.QuerySync(ctx, nostr.Filter{IDs: []string{proposalID}, Kinds: []int{kindPoll}})
	if err != nil || len(found) == 0 {
		return fmt.Errorf("proposal not found")
	}
	proposal, err := parseDaoProposal(found[0])
	if err != nil {
		return err
	}

	_, eligible, err := groupRoster(ctx, relay, proposal.groupID, proposal.evt.CreatedAt)
	if err != nil {
		return err
	}

	// Only votes that carry this group's "h" tag count: those are the
	// ones server/nip29.go actually gated to members. A vote without the
	// tag is an ordinary NIP-88 response the relay couldn't gate.
	votes, err := relay.QuerySync(ctx, nostr.Filter{
		Kinds: []int{kindPollResponse},
		Tags:  nostr.TagMap{"e": []string{proposalID}, "h": []string{proposal.groupID}},
	})
	if err != nil {
		return err
	}
	res := tallyVotes(proposal, eligible, votes)

	contentJSON, _ := json.Marshal(res)
	value := "rejected"
	if res.Passed {
		value = "passed"
	}
	label := nostr.Event{
		Kind:      kindLabel,
		CreatedAt: nostr.Now(),
		Content:   string(contentJSON),
		Tags: nostr.Tags{
			{"L", daoLabelNamespace},
			{"l", value, daoLabelNamespace},
			{"e", proposalID},
			{"h", proposal.groupID},
		},
	}
	if err := signAndPublishChecked(ctx, relay, communityKeySk, label); err != nil {
		return err
	}
	fmt.Printf("DAO tally for %s: %s (%d/%d voted)\n", proposalID[:8], value, res.Voted, res.Eligible)
	return nil
}

// tallyVotes is pure (no I/O) so it's easy to reason about and recount:
//   - eligible = admins + members as of the proposal's created_at
//   - each eligible voter's latest vote with created_at <= endsAt counts
//     (NIP-88: latest response per pubkey wins); for that vote, the first
//     response tag naming a real option is the choice (single-choice)
//   - quorum is a minimum: voted/eligible >= quorum
//   - threshold must be exceeded: approve/voted > threshold, except a
//     threshold of 1 means unanimous (approve == voted)
func tallyVotes(p *daoProposal, eligible map[string]bool, votes []*nostr.Event) daoTallyResult {
	latest := map[string]*nostr.Event{}
	for _, v := range votes {
		if !eligible[v.PubKey] || int64(v.CreatedAt) > p.endsAt {
			continue
		}
		if cur, ok := latest[v.PubKey]; !ok || v.CreatedAt > cur.CreatedAt {
			latest[v.PubKey] = v
		}
	}

	res := daoTallyResult{
		Eligible:  len(eligible),
		Counts:    map[string]int{},
		Approve:   p.approve,
		Quorum:    p.quorum,
		Threshold: p.threshold,
	}
	for opt := range p.options {
		res.Counts[opt] = 0
	}
	for _, v := range latest {
		for _, tag := range v.Tags {
			if len(tag) >= 2 && tag[0] == "response" && p.options[tag[1]] {
				res.Counts[tag[1]]++
				res.Voted++
				break
			}
		}
	}

	if res.Eligible > 0 {
		res.QuorumMet = float64(res.Voted)/float64(res.Eligible) >= p.quorum
	}
	if res.Voted > 0 {
		approve := res.Counts[p.approve]
		res.ApproveShare = float64(approve) / float64(res.Voted)
		if p.threshold >= 1 {
			res.Passed = res.QuorumMet && approve == res.Voted
		} else {
			res.Passed = res.QuorumMet && res.ApproveShare > p.threshold
		}
	}
	return res
}
