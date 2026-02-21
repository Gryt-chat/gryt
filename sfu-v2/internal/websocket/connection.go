package websocket

import (
	"sync"

	"github.com/gorilla/websocket"
)

// ThreadSafeWriter wraps a WebSocket connection with a mutex to ensure safe concurrent access
type ThreadSafeWriter struct {
	*websocket.Conn
	sync.Mutex
}

// WriteJSON writes a JSON message to the WebSocket connection in a thread-safe manner
func (t *ThreadSafeWriter) WriteJSON(v interface{}) error {
	t.Lock()
	defer t.Unlock()
	return t.Conn.WriteJSON(v)
}

// NewThreadSafeWriter creates a new thread-safe WebSocket writer
func NewThreadSafeWriter(conn *websocket.Conn) *ThreadSafeWriter {
	return &ThreadSafeWriter{
		Conn:  conn,
		Mutex: sync.Mutex{},
	}
}
