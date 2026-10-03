package badger

import (
	"context"

	"github.com/dgraph-io/badger/v4"
	bin "github.com/fiatjaf/eventstore/internal/binary"
	"github.com/nbd-wtf/go-nostr"
)

// ScanRawEvents walks every stored event, calling fn with the decoded
// event and the size in bytes of its stored value. fn returns false to
// stop early. NOSTRAS addition (not upstream): used by the relay's
// storage diagnostic.
//
// The walk is split into chunks of chunkSize events, each in its own
// short read transaction, rather than one transaction for the whole
// store: a long-lived read txn pins old versions and holds back badger's
// own cleanup for as long as it's open. Between chunks the caller can
// pace itself via fn's own sleeps, or cancel via ctx. Events that fail
// to decode are skipped, not fatal.
func (b *BadgerBackend) ScanRawEvents(ctx context.Context, chunkSize int, fn func(evt *nostr.Event, size int) bool) error {
	if chunkSize <= 0 {
		chunkSize = 5000
	}
	prefix := []byte{rawEventStorePrefix}
	seek := prefix

	for {
		if err := ctx.Err(); err != nil {
			return err
		}

		var last []byte
		n := 0
		stop := false
		err := b.View(func(txn *badger.Txn) error {
			it := txn.NewIterator(badger.IteratorOptions{PrefetchValues: false, Prefix: prefix})
			defer it.Close()

			for it.Seek(seek); it.ValidForPrefix(prefix); it.Next() {
				item := it.Item()
				key := item.KeyCopy(nil)
				// seek is inclusive; skip the key the previous chunk ended on.
				if last == nil && len(seek) > 1 && string(key) == string(seek) {
					continue
				}
				last = key
				n++

				err := item.Value(func(val []byte) error {
					evt := &nostr.Event{}
					if err := bin.Unmarshal(val, evt); err != nil {
						return nil
					}
					if !fn(evt, len(val)) {
						stop = true
					}
					return nil
				})
				if err != nil {
					return err
				}
				if stop || n >= chunkSize {
					return nil
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		if stop || n == 0 || n < chunkSize {
			return nil
		}
		seek = last
	}
}
