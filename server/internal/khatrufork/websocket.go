package khatru

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/fasthttp/websocket"
	"github.com/puzpuzpuz/xsync/v3"
)

type WebSocket struct {
	conn  *websocket.Conn
	mutex sync.Mutex

	// original request
	Request *http.Request

	// this Context will be canceled whenever the connection is closed from the client side or server-side.
	Context context.Context
	cancel  context.CancelFunc

	// nip42
	Challenge       string
	AuthedPublicKey string
	Authed          chan struct{}

	// nip77
	negentropySessions *xsync.MapOf[string, *NegentropySession]

	authLock sync.Mutex
}

func (ws *WebSocket) WriteJSON(any any) error {
	ws.mutex.Lock()
	err := ws.conn.WriteJSON(any)
	ws.mutex.Unlock()
	return err
}

func (ws *WebSocket) WriteMessage(t int, b []byte) error {
	ws.mutex.Lock()
	err := ws.conn.WriteMessage(t, b)
	ws.mutex.Unlock()
	return err
}

// NOSTRAS PATCH: WriteJSONWithDeadline bounds a single write to timeout,
// so one slow/stuck subscriber can't stall a caller indefinitely. Upstream
// khatru defines a Relay.WriteWait field ("Time allowed to write a message
// to the peer") but never actually applies it anywhere via
// SetWriteDeadline -- confirmed by grepping the whole package. Used by the
// patched notifyListeners in listener.go for the broadcast fan-out path;
// the plain WriteJSON above is left untouched for other call sites.
func (ws *WebSocket) WriteJSONWithDeadline(any any, timeout time.Duration) error {
	ws.mutex.Lock()
	defer ws.mutex.Unlock()
	if timeout > 0 {
		ws.conn.SetWriteDeadline(time.Now().Add(timeout))
		// Clear the deadline afterward so it doesn't linger and affect a
		// later, unrelated write (e.g. a ping) with a stale expiry.
		defer ws.conn.SetWriteDeadline(time.Time{})
	}
	return ws.conn.WriteJSON(any)
}
