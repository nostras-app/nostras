package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"sync"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip86"
)

// NIP-86 Relay Management API. khatru's fork (internal/khatrufork/nip86.go)
// already declares and dispatches to rl.ManagementAPI — but that field was
// never actually assigned anywhere in this codebase, so every real call
// silently hit a nil method and returned "method X not supported" (found
// while building the NIP-62 vanish feature; see CLAUDE.md's NIP-62 entry).
// This file is the actual wiring, backed by real persistent storage, not
// just a stub that satisfies the interface.
//
// Auth vs. authorization: khatru's HandleNIP86 already verifies a NIP-98-
// shaped signed event proving *who* is calling (checked before any hook
// here ever runs) — it does NOT check whether that identity is allowed to
// administer this relay. That's this file's job, via RejectAPICall: only
// NOSTRAS_ADMIN_PUBKEY (the operator's own pubkey, set as a Fly secret the
// same way NOSTRAS_DASHBOARD_PASSWORD already is — never typed into chat
// or read by Claude) and pubkeys explicitly granted access via grantadmin
// may call anything. Unset NOSTRAS_ADMIN_PUBKEY means nobody can, ever —
// same safe-by-default posture as the dashboard password and DVM payment
// gating: the feature exists in code but stays inert until the operator
// deliberately turns it on.
//
// Not implemented: the newer role-based methods (createrole/editrole/
// deleterole/assignrole/unassignrole) some NIP-86 clients (e.g. `nak
// admin`) offer — the vendored go-nostr@v0.52.3 nip86 package's own
// DecodeRequest doesn't know these method names either, so they already
// fail cleanly at the decode step with "unknown method" before reaching
// any code here. A real, small, upstream-version gap, not something this
// file works around.

type nip86Data struct {
	BannedPubkeys    map[string]string   `json:"bannedPubkeys"`   // pubkey -> reason
	AllowedPubkeys   map[string]string   `json:"allowedPubkeys"`  // pubkey -> reason (informational only — see AllowPubKey below)
	BannedEvents     map[string]string   `json:"bannedEvents"`    // event id -> reason
	AllowedEvents    map[string]string   `json:"allowedEvents"`   // event id -> reason (resolves the moderation queue as "OK")
	ModerationQueue  map[string]string   `json:"moderationQueue"` // event id -> reason, populated from real NIP-56 (kind:1984) reports
	AllowedKinds     []int               `json:"allowedKinds"`    // non-empty = allow-list mode, ONLY these kinds accepted
	DisallowedKinds  []int               `json:"disallowedKinds"`
	BlockedIPs       map[string]string   `json:"blockedIPs"` // ip string -> reason
	Admins           map[string][]string `json:"admins"`     // granted pubkey -> allowed method names (operator is not stored here, see NOSTRAS_ADMIN_PUBKEY)
	RelayName        string              `json:"relayName,omitempty"`
	RelayDescription string              `json:"relayDescription,omitempty"`
	RelayIcon        string              `json:"relayIcon,omitempty"`
}

type nip86Store struct {
	mu   sync.RWMutex
	path string
	data nip86Data
}

func newNip86Store(path string) (*nip86Store, error) {
	s := &nip86Store{path: path, data: nip86Data{
		BannedPubkeys:   map[string]string{},
		AllowedPubkeys:  map[string]string{},
		BannedEvents:    map[string]string{},
		AllowedEvents:   map[string]string{},
		ModerationQueue: map[string]string{},
		BlockedIPs:      map[string]string{},
		Admins:          map[string][]string{},
	}}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &s.data); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *nip86Store) saveLocked() error {
	raw, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, raw, 0600)
}

func containsInt(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func removeInt(list []int, v int) []int {
	next := make([]int, 0, len(list))
	for _, x := range list {
		if x != v {
			next = append(next, x)
		}
	}
	return next
}

// --- enforcement checks (read side, used by the relay hooks below) ---

func (s *nip86Store) isPubkeyBanned(pubkey string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.data.BannedPubkeys[pubkey]
	return ok
}

func (s *nip86Store) isEventBanned(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.data.BannedEvents[id]
	return ok
}

func (s *nip86Store) kindAllowed(kind int) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if containsInt(s.data.DisallowedKinds, kind) {
		return false
	}
	if len(s.data.AllowedKinds) > 0 && !containsInt(s.data.AllowedKinds, kind) {
		return false
	}
	return true
}

func (s *nip86Store) isIPBlocked(ip string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.data.BlockedIPs[ip]
	return ok
}

func (s *nip86Store) isMethodGranted(pubkey, method string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, m := range s.data.Admins[pubkey] {
		if m == method {
			return true
		}
	}
	return false
}

// --- relay hooks ---

// newNip86RejectEventHook enforces banned pubkeys/events and the allowed/
// disallowed kind lists on every incoming event — this is what makes a
// banpubkey/banevent/disallowkind call actually do something, not just
// record it.
func newNip86RejectEventHook(store *nip86Store) func(ctx context.Context, evt *nostr.Event) (bool, string) {
	return func(_ context.Context, evt *nostr.Event) (bool, string) {
		if store.isPubkeyBanned(evt.PubKey) {
			return true, "blocked: pubkey banned by relay admin (NIP-86)"
		}
		if store.isEventBanned(evt.ID) {
			return true, "blocked: event banned by relay admin (NIP-86)"
		}
		if !store.kindAllowed(evt.Kind) {
			return true, "blocked: kind not permitted by relay admin (NIP-86)"
		}
		return false, ""
	}
}

// newNip86RejectConnectionHook enforces blockip — runs before the
// WebSocket upgrade, same shape as the existing maxLiveConnections check
// in health.go/main.go.
func newNip86RejectConnectionHook(store *nip86Store) func(r *http.Request) bool {
	return func(r *http.Request) bool {
		return store.isIPBlocked(khatru.GetIPFromRequest(r))
	}
}

// newNip86ReportObserverHook feeds listeventsneedingmoderation from real
// NIP-56 (kind:1984) reports this relay already receives from NOSTRAS's
// own "report" note-menu action (and any other NIP-56-capable client) —
// there was no moderation-queue source at all before this, since nothing
// in this relay previously consumed report events for anything.
func newNip86ReportObserverHook(store *nip86Store) func(ctx context.Context, evt *nostr.Event) {
	return func(_ context.Context, evt *nostr.Event) {
		if evt.Kind != nostr.KindReporting {
			return
		}
		eTag := evt.Tags.Find("e")
		if eTag == nil || len(eTag) < 2 {
			return
		}
		reportedID := eTag[1]
		reason := evt.Content
		if len(eTag) >= 3 && eTag[2] != "" {
			reason = eTag[2]
		}

		store.mu.Lock()
		defer store.mu.Unlock()
		if _, banned := store.data.BannedEvents[reportedID]; banned {
			return
		}
		if _, allowed := store.data.AllowedEvents[reportedID]; allowed {
			return
		}
		// Last report's reason wins if the same event is reported more than
		// once before an admin resolves it — a real simplification (no
		// report-count or multi-reason aggregation), not a bug.
		store.data.ModerationQueue[reportedID] = reason
		store.saveLocked()
	}
}

// applyNip86RelayInfoOverrides re-applies any persisted changerelayname/
// description/icon calls from a previous process — without this, an
// admin's rename would be silently lost on the next restart/redeploy,
// reverting to main.go's hardcoded defaults.
func applyNip86RelayInfoOverrides(relay *khatru.Relay, store *nip86Store) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	if store.data.RelayName != "" {
		relay.Info.Name = store.data.RelayName
	}
	if store.data.RelayDescription != "" {
		relay.Info.Description = store.data.RelayDescription
	}
	if store.data.RelayIcon != "" {
		relay.Info.Icon = store.data.RelayIcon
	}
}

// --- authorization ---

// newNip86RejectAPICallHook is the actual access-control gate: the
// operator (NOSTRAS_ADMIN_PUBKEY) always has full access; a pubkey granted
// specific methods via grantadmin gets exactly those; everyone else,
// including someone who can produce a validly-signed request for
// themselves (khatru's own auth check only proves identity, not
// authorization), is rejected.
func newNip86RejectAPICallHook(store *nip86Store, operatorPubkey string) func(ctx context.Context, mp nip86.MethodParams) (bool, string) {
	return func(ctx context.Context, mp nip86.MethodParams) (bool, string) {
		caller := khatru.GetAuthed(ctx)
		if caller == "" {
			return true, "unauthorized"
		}
		if operatorPubkey != "" && caller == operatorPubkey {
			return false, ""
		}
		if store.isMethodGranted(caller, mp.MethodName()) {
			return false, ""
		}
		return true, "unauthorized: this pubkey is not a relay admin"
	}
}

// --- ManagementAPI construction ---

// buildNip86ManagementAPI wires every method the fork's dispatch code
// knows how to call (see internal/khatrufork/nip86.go's switch) to real,
// persisted behavior. grantadmin/revokeadmin are deliberately
// operator-only regardless of what a granted admin's own method list
// says — not delegable, so a compromised granted-admin key can't create
// further admins.
func buildNip86ManagementAPI(relay *khatru.Relay, db *badger.BadgerBackend, store *nip86Store, operatorPubkey string) khatru.RelayManagementAPI {
	requireOperator := func(ctx context.Context) error {
		if operatorPubkey == "" || khatru.GetAuthed(ctx) != operatorPubkey {
			return fmt.Errorf("only the relay operator may call this method")
		}
		return nil
	}

	return khatru.RelayManagementAPI{
		RejectAPICall: []func(ctx context.Context, mp nip86.MethodParams) (bool, string){
			newNip86RejectAPICallHook(store, operatorPubkey),
		},

		BanPubKey: func(_ context.Context, pubkey, reason string) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			store.data.BannedPubkeys[pubkey] = reason
			return store.saveLocked()
		},
		ListBannedPubKeys: func(_ context.Context) ([]nip86.PubKeyReason, error) {
			store.mu.RLock()
			defer store.mu.RUnlock()
			out := make([]nip86.PubKeyReason, 0, len(store.data.BannedPubkeys))
			for pk, reason := range store.data.BannedPubkeys {
				out = append(out, nip86.PubKeyReason{PubKey: pk, Reason: reason})
			}
			return out, nil
		},
		// AllowPubKey doubles as "unban" — the vendored nip86 package has no
		// separate unban method, and for an open relay (NOSTRAS has no
		// allow-list-only mode for pubkeys) treating "allow" as "this pubkey
		// is fine, remove any ban" is the only behavior that's actually
		// useful here. Recorded in AllowedPubkeys too, informationally.
		AllowPubKey: func(_ context.Context, pubkey, reason string) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			delete(store.data.BannedPubkeys, pubkey)
			store.data.AllowedPubkeys[pubkey] = reason
			return store.saveLocked()
		},
		ListAllowedPubKeys: func(_ context.Context) ([]nip86.PubKeyReason, error) {
			store.mu.RLock()
			defer store.mu.RUnlock()
			out := make([]nip86.PubKeyReason, 0, len(store.data.AllowedPubkeys))
			for pk, reason := range store.data.AllowedPubkeys {
				out = append(out, nip86.PubKeyReason{PubKey: pk, Reason: reason})
			}
			return out, nil
		},

		ListEventsNeedingModeration: func(_ context.Context) ([]nip86.IDReason, error) {
			store.mu.RLock()
			defer store.mu.RUnlock()
			out := make([]nip86.IDReason, 0, len(store.data.ModerationQueue))
			for id, reason := range store.data.ModerationQueue {
				out = append(out, nip86.IDReason{ID: id, Reason: reason})
			}
			return out, nil
		},
		// BanEvent both blocks future (re-)storage of this exact event id
		// (via the RejectEvent hook above) and deletes any copy already
		// stored — reusing relay.DeleteEvent's existing hook chain (badger +
		// bluge search index together), the same reuse pattern vanish.go
		// already established for NIP-62.
		BanEvent: func(ctx context.Context, id, reason string) error {
			store.mu.Lock()
			store.data.BannedEvents[id] = reason
			delete(store.data.ModerationQueue, id)
			delete(store.data.AllowedEvents, id)
			err := store.saveLocked()
			store.mu.Unlock()
			if err != nil {
				return err
			}

			ch, qerr := db.QueryEvents(ctx, nostr.Filter{IDs: []string{id}})
			if qerr != nil {
				return nil // the ban itself is already recorded; a query failure here isn't fatal
			}
			for target := range ch {
				for _, del := range relay.DeleteEvent {
					del(ctx, target)
				}
			}
			return nil
		},
		// AllowEvent resolves a moderation-queue entry as "this is fine" —
		// also clears a prior ban, symmetric with AllowPubKey above.
		AllowEvent: func(_ context.Context, id, reason string) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			delete(store.data.BannedEvents, id)
			delete(store.data.ModerationQueue, id)
			store.data.AllowedEvents[id] = reason
			return store.saveLocked()
		},
		ListBannedEvents: func(_ context.Context) ([]nip86.IDReason, error) {
			store.mu.RLock()
			defer store.mu.RUnlock()
			out := make([]nip86.IDReason, 0, len(store.data.BannedEvents))
			for id, reason := range store.data.BannedEvents {
				out = append(out, nip86.IDReason{ID: id, Reason: reason})
			}
			return out, nil
		},
		ListAllowedEvents: func(_ context.Context) ([]nip86.IDReason, error) {
			store.mu.RLock()
			defer store.mu.RUnlock()
			out := make([]nip86.IDReason, 0, len(store.data.AllowedEvents))
			for id, reason := range store.data.AllowedEvents {
				out = append(out, nip86.IDReason{ID: id, Reason: reason})
			}
			return out, nil
		},

		ChangeRelayName: func(_ context.Context, name string) error {
			store.mu.Lock()
			store.data.RelayName = name
			err := store.saveLocked()
			store.mu.Unlock()
			if err != nil {
				return err
			}
			relay.Info.Name = name
			return nil
		},
		ChangeRelayDescription: func(_ context.Context, desc string) error {
			store.mu.Lock()
			store.data.RelayDescription = desc
			err := store.saveLocked()
			store.mu.Unlock()
			if err != nil {
				return err
			}
			relay.Info.Description = desc
			return nil
		},
		ChangeRelayIcon: func(_ context.Context, icon string) error {
			store.mu.Lock()
			store.data.RelayIcon = icon
			err := store.saveLocked()
			store.mu.Unlock()
			if err != nil {
				return err
			}
			relay.Info.Icon = icon
			return nil
		},

		// allowkind/disallowkind are two independent lists, matching
		// conventional relay ACL semantics: disallowedKinds is always
		// enforced; allowedKinds, once non-empty, switches the relay into
		// allow-list mode where ONLY those kinds are accepted. Real footgun,
		// documented loudly in CLAUDE.md: turning this on without including
		// every kind NOSTRAS's own client depends on would break the app for
		// everyone — deliberate, spec-faithful behavior, not a bug, but easy
		// to misuse by mistake.
		AllowKind: func(_ context.Context, kind int) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			if !containsInt(store.data.AllowedKinds, kind) {
				store.data.AllowedKinds = append(store.data.AllowedKinds, kind)
			}
			store.data.DisallowedKinds = removeInt(store.data.DisallowedKinds, kind)
			return store.saveLocked()
		},
		DisallowKind: func(_ context.Context, kind int) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			if !containsInt(store.data.DisallowedKinds, kind) {
				store.data.DisallowedKinds = append(store.data.DisallowedKinds, kind)
			}
			store.data.AllowedKinds = removeInt(store.data.AllowedKinds, kind)
			return store.saveLocked()
		},
		ListAllowedKinds: func(_ context.Context) ([]int, error) {
			store.mu.RLock()
			defer store.mu.RUnlock()
			out := make([]int, len(store.data.AllowedKinds))
			copy(out, store.data.AllowedKinds)
			return out, nil
		},
		ListDisAllowedKinds: func(_ context.Context) ([]int, error) {
			store.mu.RLock()
			defer store.mu.RUnlock()
			out := make([]int, len(store.data.DisallowedKinds))
			copy(out, store.data.DisallowedKinds)
			return out, nil
		},

		BlockIP: func(_ context.Context, ip net.IP, reason string) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			store.data.BlockedIPs[ip.String()] = reason
			return store.saveLocked()
		},
		UnblockIP: func(_ context.Context, ip net.IP, _ string) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			delete(store.data.BlockedIPs, ip.String())
			return store.saveLocked()
		},
		ListBlockedIPs: func(_ context.Context) ([]nip86.IPReason, error) {
			store.mu.RLock()
			defer store.mu.RUnlock()
			out := make([]nip86.IPReason, 0, len(store.data.BlockedIPs))
			for ip, reason := range store.data.BlockedIPs {
				out = append(out, nip86.IPReason{IP: ip, Reason: reason})
			}
			return out, nil
		},

		// Stats' own interface (fork-defined) types the method as returning
		// a full nip86.Response, not a plain value like every other method —
		// reproduced faithfully as-is (the fork's own dispatch code assigns
		// this return value directly to the outer response's Result field,
		// nesting a Response inside a Response), not corrected here since
		// fixing the fork's own dispatch shape is out of scope for this
		// feature.
		Stats: func(_ context.Context) (nip86.Response, error) {
			h := getHealthSnapshot()
			store.mu.RLock()
			defer store.mu.RUnlock()
			return nip86.Response{Result: map[string]any{
				"liveConnections":       h.LiveConnections,
				"uptimeSeconds":         h.UptimeSeconds,
				"bannedPubkeys":         len(store.data.BannedPubkeys),
				"allowedPubkeys":        len(store.data.AllowedPubkeys),
				"bannedEvents":          len(store.data.BannedEvents),
				"allowedEvents":         len(store.data.AllowedEvents),
				"moderationQueueLength": len(store.data.ModerationQueue),
				"blockedIPs":            len(store.data.BlockedIPs),
				"grantedAdmins":         len(store.data.Admins),
			}}, nil
		},

		GrantAdmin: func(ctx context.Context, pubkey string, methods []string) error {
			if err := requireOperator(ctx); err != nil {
				return err
			}
			store.mu.Lock()
			defer store.mu.Unlock()
			store.data.Admins[pubkey] = methods
			return store.saveLocked()
		},
		RevokeAdmin: func(ctx context.Context, pubkey string, methods []string) error {
			if err := requireOperator(ctx); err != nil {
				return err
			}
			store.mu.Lock()
			defer store.mu.Unlock()
			if len(methods) == 0 {
				delete(store.data.Admins, pubkey)
			} else {
				remaining := store.data.Admins[pubkey]
				for _, m := range methods {
					next := make([]string, 0, len(remaining))
					for _, existing := range remaining {
						if existing != m {
							next = append(next, existing)
						}
					}
					remaining = next
				}
				if len(remaining) == 0 {
					delete(store.data.Admins, pubkey)
				} else {
					store.data.Admins[pubkey] = remaining
				}
			}
			return store.saveLocked()
		},
	}
}
