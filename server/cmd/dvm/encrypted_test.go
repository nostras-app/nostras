package main

import (
	"encoding/json"
	"testing"

	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip44"
)

func encryptedRequest(t *testing.T, userSk, dvmPk string, inner nostr.Tags) *nostr.Event {
	t.Helper()
	payload, _ := json.Marshal(inner)
	convKey, err := nip44.GenerateConversationKey(dvmPk, userSk)
	if err != nil {
		t.Fatal(err)
	}
	ct, err := nip44.Encrypt(string(payload), convKey)
	if err != nil {
		t.Fatal(err)
	}
	userPk, _ := nostr.GetPublicKey(userSk)
	return &nostr.Event{
		Kind:    kindJobRequestGenerate,
		PubKey:  userPk,
		Content: ct,
		Tags:    nostr.Tags{{"p", dvmPk}, {"encrypted"}},
	}
}

func TestJobRequestTags(t *testing.T) {
	dvmSk := nostr.GeneratePrivateKey()
	dvmPk, _ := nostr.GetPublicKey(dvmSk)
	userSk := nostr.GeneratePrivateKey()
	inner := nostr.Tags{{"i", "what is nostr?", "text"}, {"param", "language", "es"}}

	t.Run("plaintext request uses its own tags", func(t *testing.T) {
		req := &nostr.Event{Tags: nostr.Tags{{"i", "hello", "text"}}}
		tags, enc, ok := jobRequestTags(req, dvmSk)
		if !ok || enc || tags.Find("i")[1] != "hello" {
			t.Fatalf("got tags=%v enc=%v ok=%v", tags, enc, ok)
		}
	})

	t.Run("encrypted to us decrypts", func(t *testing.T) {
		req := encryptedRequest(t, userSk, dvmPk, inner)
		tags, enc, ok := jobRequestTags(req, dvmSk)
		if !ok || !enc || tags == nil {
			t.Fatalf("got tags=%v enc=%v ok=%v", tags, enc, ok)
		}
		if tags.Find("i")[1] != "what is nostr?" || tags.Find("param")[2] != "es" {
			t.Fatalf("wrong tags: %v", tags)
		}
	})

	t.Run("encrypted to another provider is ignored", func(t *testing.T) {
		otherSk := nostr.GeneratePrivateKey()
		otherPk, _ := nostr.GetPublicKey(otherSk)
		req := encryptedRequest(t, userSk, otherPk, inner)
		if _, _, ok := jobRequestTags(req, dvmSk); ok {
			t.Fatal("expected request for another provider to be ignored")
		}
	})

	t.Run("encrypted without p tag is ignored", func(t *testing.T) {
		req := encryptedRequest(t, userSk, dvmPk, inner)
		req.Tags = nostr.Tags{{"encrypted"}}
		if _, _, ok := jobRequestTags(req, dvmSk); ok {
			t.Fatal("expected request without p tag to be ignored")
		}
	})

	t.Run("undecryptable content addressed to us reports nil tags", func(t *testing.T) {
		req := encryptedRequest(t, userSk, dvmPk, inner)
		req.Content = "not-ciphertext"
		tags, enc, ok := jobRequestTags(req, dvmSk)
		if !ok || !enc || tags != nil {
			t.Fatalf("got tags=%v enc=%v ok=%v", tags, enc, ok)
		}
	})
}
