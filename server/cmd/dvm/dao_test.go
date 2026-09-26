package main

import (
	"testing"

	"github.com/nbd-wtf/go-nostr"
)

func testProposal(quorum, threshold float64) *daoProposal {
	return &daoProposal{
		groupID:   "g",
		quorum:    quorum,
		threshold: threshold,
		approve:   "yes",
		endsAt:    1000,
		options:   map[string]bool{"yes": true, "no": true},
	}
}

func vote(pubkey string, at int64, choices ...string) *nostr.Event {
	tags := nostr.Tags{{"e", "proposal"}, {"h", "g"}}
	for _, c := range choices {
		tags = append(tags, nostr.Tag{"response", c})
	}
	return &nostr.Event{PubKey: pubkey, CreatedAt: nostr.Timestamp(at), Tags: tags, Kind: kindPollResponse}
}

func roster(pubkeys ...string) map[string]bool {
	m := map[string]bool{}
	for _, p := range pubkeys {
		m[p] = true
	}
	return m
}

func TestTallyVotes(t *testing.T) {
	cases := []struct {
		name       string
		p          *daoProposal
		eligible   map[string]bool
		votes      []*nostr.Event
		wantVoted  int
		wantYes    int
		wantQuorum bool
		wantPassed bool
	}{
		{
			name: "simple majority passes", p: testProposal(0.5, 0.5),
			eligible:  roster("a", "b", "c"),
			votes:     []*nostr.Event{vote("a", 10, "yes"), vote("b", 10, "yes"), vote("c", 10, "no")},
			wantVoted: 3, wantYes: 2, wantQuorum: true, wantPassed: true,
		},
		{
			name: "exact threshold tie does not pass", p: testProposal(0.5, 0.5),
			eligible:  roster("a", "b"),
			votes:     []*nostr.Event{vote("a", 10, "yes"), vote("b", 10, "no")},
			wantVoted: 2, wantYes: 1, wantQuorum: true, wantPassed: false,
		},
		{
			name: "quorum not met", p: testProposal(0.5, 0.5),
			eligible:  roster("a", "b", "c", "d", "e"),
			votes:     []*nostr.Event{vote("a", 10, "yes"), vote("b", 10, "yes")},
			wantVoted: 2, wantYes: 2, wantQuorum: false, wantPassed: false,
		},
		{
			name: "non-member votes ignored", p: testProposal(0.5, 0.5),
			eligible:  roster("a", "b"),
			votes:     []*nostr.Event{vote("a", 10, "no"), vote("x", 10, "yes"), vote("y", 10, "yes")},
			wantVoted: 1, wantYes: 0, wantQuorum: true, wantPassed: false,
		},
		{
			name: "latest vote per member wins", p: testProposal(0.5, 0.5),
			eligible:  roster("a"),
			votes:     []*nostr.Event{vote("a", 10, "no"), vote("a", 20, "yes")},
			wantVoted: 1, wantYes: 1, wantQuorum: true, wantPassed: true,
		},
		{
			name: "vote after endsAt ignored, earlier one kept", p: testProposal(0.5, 0.5),
			eligible:  roster("a"),
			votes:     []*nostr.Event{vote("a", 10, "no"), vote("a", 1001, "yes")},
			wantVoted: 1, wantYes: 0, wantQuorum: true, wantPassed: false,
		},
		{
			name: "invalid option skipped, first valid response counts", p: testProposal(0.5, 0.5),
			eligible:  roster("a"),
			votes:     []*nostr.Event{vote("a", 10, "bogus", "yes", "no")},
			wantVoted: 1, wantYes: 1, wantQuorum: true, wantPassed: true,
		},
		{
			name: "unanimous threshold 1 passes only if all voters approve", p: testProposal(0.1, 1),
			eligible:  roster("a", "b"),
			votes:     []*nostr.Event{vote("a", 10, "yes"), vote("b", 10, "yes")},
			wantVoted: 2, wantYes: 2, wantQuorum: true, wantPassed: true,
		},
		{
			name: "unanimous threshold 1 fails with one no", p: testProposal(0.1, 1),
			eligible:  roster("a", "b"),
			votes:     []*nostr.Event{vote("a", 10, "yes"), vote("b", 10, "no")},
			wantVoted: 2, wantYes: 1, wantQuorum: true, wantPassed: false,
		},
		{
			name: "no votes at all is rejected", p: testProposal(0.1, 0.5),
			eligible:  roster("a", "b"),
			votes:     nil,
			wantVoted: 0, wantYes: 0, wantQuorum: false, wantPassed: false,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := tallyVotes(c.p, c.eligible, c.votes)
			if res.Voted != c.wantVoted || res.Counts["yes"] != c.wantYes || res.QuorumMet != c.wantQuorum || res.Passed != c.wantPassed {
				t.Fatalf("got voted=%d yes=%d quorum=%v passed=%v; want voted=%d yes=%d quorum=%v passed=%v",
					res.Voted, res.Counts["yes"], res.QuorumMet, res.Passed, c.wantVoted, c.wantYes, c.wantQuorum, c.wantPassed)
			}
		})
	}
}
