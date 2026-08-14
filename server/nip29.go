package main

import (
	"context"
	"sort"
	"sync"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/eventstore/bluge"
	"github.com/nbd-wtf/go-nostr"
)

// NIP-29 (relay-based groups). v1 scope, deliberate: public + open groups
// only — any authenticated pubkey may read and post kind:9 chat once a
// group exists; only admin actions are permission-gated. Private groups
// (read-gating) and closed groups (join-approval before posting) are a
// later phase, not implemented here. See CLAUDE.md for the full writeup.

// maxGroupIDLength is a cheap sanity bound on client-supplied group ids
// (the "h"/"d" tag value) — not a spec requirement, just guards against a
// pathological/abusive id from ever entering the cache.
const maxGroupIDLength = 200

var groupChatKinds = map[int]bool{
	nostr.KindSimpleGroupChatMessage:   true,
	nostr.KindSimpleGroupThreadedReply: true,
	nostr.KindSimpleGroupThread:        true,
	nostr.KindSimpleGroupReply:         true,
}

// Moderation kinds, admin-gated. kind:9007 (create-group) is handled
// separately (it has no group to check admin-status against yet).
var groupModerationKinds = map[int]bool{
	nostr.KindSimpleGroupPutUser:      true,
	nostr.KindSimpleGroupRemoveUser:   true,
	nostr.KindSimpleGroupEditMetadata: true,
	nostr.KindSimpleGroupDeleteEvent:  true,
	nostr.KindSimpleGroupDeleteGroup:  true,
	nostr.KindSimpleGroupCreateInvite: true,
}

// The addressable group-state kinds (metadata/admins/members/roles) are
// client-signed in this design (the relay never mints/signs its own
// events — see the create-group comment below), so they're ALSO
// admin-gated here at write time, purely to stop a random pubkey from
// publishing a fake 39001 claiming to be admin of a group they don't
// own. They deliberately do NOT feed back into the permission cache
// itself — see the real bug this caused, described on
// nip29CacheAuthority below.
var groupAddressableKinds = map[int]bool{
	nostr.KindSimpleGroupMetadata: true,
	nostr.KindSimpleGroupAdmins:   true,
	nostr.KindSimpleGroupMembers:  true,
	nostr.KindSimpleGroupRoles:    true,
}

func isNip29Kind(kind int) bool {
	return kind == nostr.KindSimpleGroupCreateGroup ||
		groupChatKinds[kind] || groupModerationKinds[kind] || groupAddressableKinds[kind]
}

// groupIDFromEvent extracts a group id from a single, unambiguous tag —
// "d" for the addressable kinds (standard NIP-33 addressing), "h" for
// everything else (the NIP-29 group tag). Fails closed on a missing or
// duplicated tag rather than silently taking "the first one" — ambiguous
// group targeting should never be resolved by guessing.
func groupIDFromEvent(evt *nostr.Event) (string, bool) {
	tagName := "h"
	if groupAddressableKinds[evt.Kind] {
		tagName = "d"
	}
	id := ""
	count := 0
	for _, tag := range evt.Tags {
		if len(tag) >= 2 && tag[0] == tagName {
			count++
			id = tag[1]
		}
	}
	if count != 1 || id == "" || len(id) > maxGroupIDLength {
		return "", false
	}
	return id, true
}

// cachedGroup tracks only what v1 enforcement actually needs: which
// pubkeys are admins. v1 has no membership-gated behavior (open groups —
// posting isn't checked against a member list at all), so there's
// deliberately no separate "members" set to keep in sync — one less
// thing that can drift from reality.
//
// Only kind:9007 (create-group), kind:9000 (put-user/promote), and
// kind:9001 (remove-user/demote) ever drive this cache — never
// kind:39001/39002 (admins/members), even though those are real,
// admin-gated, storable/queryable events. Found this the hard way during
// Piece 1's own live verification, not theorized in advance: a promoted
// admin published their own real, legitimately-accepted kind:39001
// self-declaration while they WERE admin; a later kind:9001 demotion
// updated the live cache correctly, but that self-declaration event
// stayed in storage untouched (kind:39001 is addressable per (kind,
// pubkey, d) — a different admin's self-declaration is a DIFFERENT
// address, so nothing about a demotion supersedes or removes it). A
// relay restart's boot scan, if it trusted 39001 events as
// cache-authoritative, would re-merge that stale self-declaration and
// silently resurrect the revoked admin status — confirmed live: this
// exact scenario let a demoted user pass an admin-only check again
// immediately after a restart. 9007/9000/9001 are a single, unambiguous,
// relay-verified event history with no such staleness hazard (every one
// of them was already admin-gated at write time, and nothing else can
// "leave behind" a stale standing grant the way a multi-author
// addressable kind can), so they're the only source of truth here, both
// live (OnEventSaved) and at boot (loadFromStore, replayed in
// chronological order). 39001/39002 remain real, writable (admin-gated),
// and freely queryable — just informational snapshots a client can
// publish/read, not something the relay's own enforcement trusts.
type cachedGroup struct {
	admins map[string]bool
}

// groupCache is an in-memory, mutex-guarded cache of per-group admin
// state, kept warm by OnEventSaved and a one-time boot scan. This exists
// so the hot-path RejectEvent check (run for EVERY incoming event, of
// every kind — confirmed via internal/khatrufork/adding.go's
// handleNormal, which loops the whole RejectEvent slice before storing
// anything) is a cheap map lookup, never a synchronous badger query.
// Unlike StoreEvent hooks, RejectEvent can't defer slow work to a
// goroutine — its return value gates storage synchronously — which is why
// this cache exists at all rather than querying badger per event (see the
// push-notification lock-contention incident in CLAUDE.md for what
// happens when a hook on this path isn't kept cheap).
//
// sync.RWMutex, not the plain sync.Mutex used elsewhere in this codebase
// for low-frequency connection-churn state (health.go's disconnectSeenMu,
// analytics.go's mu) — this cache is read on every single incoming event
// once real groups exist, so the read/write ratio justifies the
// deviation.
type groupCache struct {
	mu     sync.RWMutex
	groups map[string]*cachedGroup // key: group id
}

func newGroupCache() *groupCache {
	return &groupCache{groups: make(map[string]*cachedGroup)}
}

func (c *groupCache) exists(id string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.groups[id] != nil
}

func (c *groupCache) isAdmin(id, pubkey string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	g := c.groups[id]
	return g != nil && g.admins[pubkey]
}

// createGroup seeds a brand-new group with its creator as sole admin, the
// moment a kind:9007 is stored. Idempotent — first-writer-wins for a
// given id — since re-parenting an existing group's admin via a bare
// duplicate create-group event would otherwise be a real
// privilege-escalation path.
func (c *groupCache) createGroup(id, creatorPubkey string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.groups[id]; exists {
		return
	}
	c.groups[id] = &cachedGroup{admins: map[string]bool{creatorPubkey: true}}
}

func (c *groupCache) deleteGroup(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.groups, id)
}

// applyPutUser/applyRemoveUser handle kind:9000/9001 — the sole source of
// truth for admin state, live and at boot (see nip29CacheAuthority
// above). v1 has no named roles, so any "p" tag on a put-user event is
// treated as a promotion to admin regardless of which role name(s) it
// carries — a binary admin/member model.
func (c *groupCache) applyPutUser(id string, evt *nostr.Event) {
	c.mu.Lock()
	defer c.mu.Unlock()
	g, ok := c.groups[id]
	if !ok {
		return
	}
	for _, tag := range evt.Tags {
		if len(tag) < 2 || tag[0] != "p" || !nostr.IsValid32ByteHex(tag[1]) {
			continue
		}
		g.admins[tag[1]] = true
	}
}

func (c *groupCache) applyRemoveUser(id string, evt *nostr.Event) {
	c.mu.Lock()
	defer c.mu.Unlock()
	g, ok := c.groups[id]
	if !ok {
		return
	}
	for _, tag := range evt.Tags {
		if len(tag) < 2 || tag[0] != "p" {
			continue
		}
		delete(g.admins, tag[1])
	}
}

// loadFromStore populates the cache once at boot by replaying every
// kind:9007/9008/9000/9001 event already in badger, in chronological
// (CreatedAt) order — the exact same history that drove the cache live,
// through the exact same apply functions, so boot state can never diverge
// from what live updates would have produced. Deliberately does NOT
// consult kind:39001/39002 at all — see nip29CacheAuthority above for
// the real bug that caused.
func (c *groupCache) loadFromStore(ctx context.Context, db *badger.BadgerBackend) error {
	ch, err := db.QueryEvents(ctx, nostr.Filter{Kinds: []int{
		nostr.KindSimpleGroupCreateGroup,
		nostr.KindSimpleGroupDeleteGroup,
		nostr.KindSimpleGroupPutUser,
		nostr.KindSimpleGroupRemoveUser,
	}})
	if err != nil {
		return err
	}

	var history []*nostr.Event
	for evt := range ch {
		history = append(history, evt)
	}
	sort.Slice(history, func(i, j int) bool { return history[i].CreatedAt < history[j].CreatedAt })

	for _, evt := range history {
		applyNip29CacheEvent(c, evt)
	}
	return nil
}

// applyNip29CacheEvent is the single switch shared by the live
// OnEventSaved hook and the boot-time replay, so the two can never drift
// apart by accident.
func applyNip29CacheEvent(cache *groupCache, evt *nostr.Event) {
	id, ok := groupIDFromEvent(evt)
	if !ok {
		return
	}
	switch evt.Kind {
	case nostr.KindSimpleGroupCreateGroup:
		cache.createGroup(id, evt.PubKey)
	case nostr.KindSimpleGroupDeleteGroup:
		cache.deleteGroup(id)
	case nostr.KindSimpleGroupPutUser:
		cache.applyPutUser(id, evt)
	case nostr.KindSimpleGroupRemoveUser:
		cache.applyRemoveUser(id, evt)
	}
}

// newNip29RejectEventHook is appended to relay.RejectEvent. Runs on every
// incoming event regardless of kind, so the kind-check is the very first
// thing done — a cheap map lookup that costs the overwhelming majority of
// non-group traffic essentially nothing.
// hasTag reports whether evt carries at least one tag named name,
// regardless of the tag's length (a bare marker tag like ["-"] still
// counts) — used below for a presence check, not a value extraction.
func hasTag(evt *nostr.Event, name string) bool {
	for _, tag := range evt.Tags {
		if len(tag) >= 1 && tag[0] == name {
			return true
		}
	}
	return false
}

func newNip29RejectEventHook(cache *groupCache) func(ctx context.Context, evt *nostr.Event) (bool, string) {
	return func(ctx context.Context, evt *nostr.Event) (bool, string) {
		if !isNip29Kind(evt.Kind) {
			return false, ""
		}

		// Real conflict found while building NIP-7D (2026-08-14):
		// go-nostr's own KindSimpleGroupThread constant is 11 — the exact
		// same kind NIP-7D independently claims for general, ungrouped
		// public forum threads. Per NIP-29's own definition, a group-
		// chat-family event only means anything with a real "h" (group)
		// tag; one of these kinds with no "h" tag at all was never valid
		// NIP-29 content to begin with, so it's treated as ordinary
		// content here instead of rejected. Deliberately scoped to just
		// this one kind, the only one with a confirmed real collision —
		// kind:9/10/12 keep requiring "h" unchanged, since nothing else
		// this relay implements claims them.
		if evt.Kind == nostr.KindSimpleGroupThread && !hasTag(evt, "h") {
			return false, ""
		}

		id, ok := groupIDFromEvent(evt)
		if !ok {
			return true, "invalid: missing or ambiguous group tag"
		}

		if evt.Kind == nostr.KindSimpleGroupCreateGroup {
			if cache.exists(id) {
				return true, "blocked: group already exists"
			}
			return false, ""
		}

		if !cache.exists(id) {
			return true, "blocked: group does not exist"
		}

		if groupChatKinds[evt.Kind] {
			// v1: open groups — any authenticated pubkey may post once
			// the group exists. No membership check.
			return false, ""
		}

		// Moderation kinds + the addressable group-state kinds
		// themselves (see the groupAddressableKinds comment above for
		// why the latter are gated too): admin only.
		if !cache.isAdmin(id, evt.PubKey) {
			return true, "blocked: admin only"
		}
		return false, ""
	}
}

// newNip29CacheUpdateHook is appended to relay.OnEventSaved, keeping the
// cache live without ever requiring a relay restart to reflect a
// moderation action. Only 9007/9008/9000/9001 do anything here — see
// nip29CacheAuthority above.
func newNip29CacheUpdateHook(cache *groupCache) func(ctx context.Context, evt *nostr.Event) {
	return func(ctx context.Context, evt *nostr.Event) {
		if !isNip29Kind(evt.Kind) {
			return
		}
		applyNip29CacheEvent(cache, evt)
	}
}

// newGroupChatSearchIndexHook wraps searchIndex.SaveEvent to exclude
// kind:9/10/11/12 group chat from the NIP-50 full-text index. Default-off
// is the safer posture: group chat is higher-volume and more casual than
// notes/articles, and once private groups exist in a later phase,
// indexing their content into a globally-searchable index would be a real
// content leak — easy to enable later, much harder to un-leak indexed
// content after the fact.
func newGroupChatSearchIndexHook(searchIndex *bluge.BlugeBackend) func(ctx context.Context, evt *nostr.Event) error {
	return func(ctx context.Context, evt *nostr.Event) error {
		// hasTag(evt, "h") mirrors the same real-vs-collision distinction
		// as the reject hook above: kind:9/10/12 always carry a real "h"
		// tag by the time they reach here (the reject hook still requires
		// it for those, unchanged), so this check is a no-op for them: a
		// genuine group message stays excluded either way. For kind:11,
		// this is what correctly excludes a real NIP-29 group thread
		// while still indexing an ungrouped NIP-7D forum thread — the
		// latter is ordinary public content, same as an article or note.
		if groupChatKinds[evt.Kind] && hasTag(evt, "h") {
			return nil
		}
		return searchIndex.SaveEvent(ctx, evt)
	}
}
