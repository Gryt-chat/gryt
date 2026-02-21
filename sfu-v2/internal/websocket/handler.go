package websocket

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"net/url"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v3"

	"sfu-v2/internal/config"
	"sfu-v2/internal/recovery"
	"sfu-v2/internal/room"
	"sfu-v2/internal/track"
	peerManager "sfu-v2/internal/webrtc"
	"sfu-v2/pkg/types"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Coordinator interface to avoid circular imports
type Coordinator interface {
	SignalPeerConnectionsInRoom(roomID string)
	OnTrackAddedToRoom(roomID string)
	OnTrackRemovedFromRoom(roomID string)
}

// Handler manages WebSocket connections and integrates with other components
type Handler struct {
	config        *config.Config
	webrtcAPI     *webrtc.API
	trackManager  *track.Manager
	webrtcManager *peerManager.Manager
	roomManager   *room.Manager
	coordinator   Coordinator
}

// NewHandler creates a new WebSocket handler
func NewHandler(cfg *config.Config, webrtcAPI *webrtc.API, trackManager *track.Manager, webrtcManager *peerManager.Manager, roomManager *room.Manager, coordinator Coordinator) *Handler {
	return &Handler{
		config:        cfg,
		webrtcAPI:     webrtcAPI,
		trackManager:  trackManager,
		webrtcManager: webrtcManager,
		roomManager:   roomManager,
		coordinator:   coordinator,
	}
}

// debugLog logs debug messages if debug mode is enabled
func (h *Handler) debugLog(format string, args ...interface{}) {
	if h.config.Debug {
		log.Printf("[WEBSOCKET] "+format, args...)
	}
}

// generateClientID generates a unique client ID
func generateClientID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// HandleWebSocket handles incoming WebSocket connections
func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	recovery.SafeExecuteWithContext("WEBSOCKET", "HANDLE_CONNECTION", "", "", r.RemoteAddr, func() error {
		unsafeConn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			if h.config.Debug {
				h.debugLog("❌ WebSocket upgrade error: %v", err)
			}
			return err
		}

		safeConn := NewThreadSafeWriter(unsafeConn)
		defer func() {
			recovery.SafeExecute("WEBSOCKET", "CLOSE_CONNECTION", func() error {
				safeConn.Close()
				return nil
			})
		}()

		clientID := generateClientID()
		parsedURL, _ := url.Parse(r.RequestURI)

		h.debugLog("🔌 New WebSocket connection: %s (Path: %s, RemoteAddr: %s)", clientID, parsedURL.Path, r.RemoteAddr)

		switch parsedURL.Path {
		case "/server":
			h.debugLog("🖥️  Handling server connection: %s", clientID)
			return h.handleServerConnection(safeConn, clientID)
		case "/client":
			h.debugLog("👤 Handling client connection: %s", clientID)
			return h.handleClientConnection(safeConn, clientID, r)
		default:
			h.debugLog("👤 Handling default client connection: %s", clientID)
			return h.handleClientConnection(safeConn, clientID, r)
		}
	})
}

// handleServerConnection handles server registration connections
func (h *Handler) handleServerConnection(conn *ThreadSafeWriter, clientID string) error {
	return recovery.SafeExecuteWithContext("WEBSOCKET", "HANDLE_SERVER", clientID, "", "Server connection handling", func() error {
		h.debugLog("🖥️  Server connection established: %s", clientID)

		for {
			var raw []byte
			var err error

			err = recovery.SafeExecuteWithContext("WEBSOCKET", "READ_SERVER_MESSAGE", clientID, "", "Reading server message", func() error {
				_, raw, err = conn.ReadMessage()
				return err
			})

			if err != nil {
				h.debugLog("❌ Error reading server message from %s: %v", clientID, err)
				return err
			}

			message := &types.WebSocketMessage{}
			if err := recovery.SafeJSONUnmarshal(raw, &message); err != nil {
				h.debugLog("❌ Error unmarshalling server message from %s: %v", clientID, err)
				continue
			}

			h.debugLog("📨 Server message from %s: event=%s", clientID, message.Event)

			err = recovery.SafeExecuteWithContext("WEBSOCKET", "PROCESS_SERVER_MESSAGE", clientID, "", message.Event, func() error {
				switch message.Event {
				case types.EventServerRegister:
					return h.handleServerRegistration(conn, clientID, message.Data)
				case types.EventKeepAlive:
					if h.config.Debug {
						h.debugLog("💓 Keep-alive received from server %s", clientID)
					}
					return nil
				default:
					h.debugLog("❓ Unknown server event from %s: %s", clientID, message.Event)
					return nil
				}
			})

			if err != nil {
				h.debugLog("❌ Error processing server message from %s: %v", clientID, err)
			}
		}
	})
}

// handleServerRegistration processes server registration
func (h *Handler) handleServerRegistration(conn *ThreadSafeWriter, clientID, data string) error {
	var regData types.ServerRegistrationData
	if err := recovery.SafeJSONUnmarshal([]byte(data), &regData); err != nil {
		h.debugLog("❌ Error unmarshalling server registration data from %s: %v", clientID, err)
		h.sendErrorToConnection(conn, "Invalid registration data")
		return err
	}

	h.debugLog("🖥️  Server registration attempt: ServerID=%s, RoomID=%s", regData.ServerID, regData.RoomID)

	if err := h.roomManager.RegisterServer(regData.ServerID, regData.ServerPassword, regData.RoomID); err != nil {
		h.debugLog("❌ Server registration failed for %s: %v", regData.ServerID, err)
		h.sendErrorToConnection(conn, "Registration failed: "+err.Error())
		return err
	}

	h.debugLog("✅ Server %s registered room %s successfully", regData.ServerID, regData.RoomID)
	h.sendSuccessToConnection(conn, "Server registered successfully")
	return nil
}

// handleClientMessages processes incoming WebSocket messages from clients
func (h *Handler) handleClientMessages(conn *ThreadSafeWriter, peerConnection *webrtc.PeerConnection, roomID, clientID string) error {
	return recovery.SafeExecuteWithContext("WEBSOCKET", "HANDLE_CLIENT_MESSAGES", clientID, roomID, "Processing client messages", func() error {
		h.debugLog("📨 Starting message handling for client %s in room '%s'", clientID, roomID)

		message := &types.WebSocketMessage{}
		messageCount := 0

		for {
			var raw []byte
			var err error

			err = recovery.SafeExecuteWithContext("WEBSOCKET", "READ_CLIENT_MESSAGE", clientID, roomID, "Reading client message", func() error {
				_, raw, err = conn.ReadMessage()
				return err
			})

			if err != nil {
				if websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
					h.debugLog("🔌 WebSocket closed normally for %s: %v", clientID, err)
					break
				}

				h.debugLog("❌ Error reading WebSocket message from %s: %v", clientID, err)
				return err
			}

			messageCount++

			if err := recovery.SafeJSONUnmarshal(raw, &message); err != nil {
				h.debugLog("❌ Error unmarshalling WebSocket message from %s: %v", clientID, err)
				continue
			}

			h.debugLog("📨 Message #%d from %s in room '%s': event=%s", messageCount, clientID, roomID, message.Event)

			err = recovery.SafeExecuteWithContext("WEBSOCKET", "PROCESS_CLIENT_MESSAGE", clientID, roomID, message.Event, func() error {
				switch message.Event {
			case types.EventCandidate:
				return h.handleICECandidate(peerConnection, message.Data, clientID)
			case types.EventAnswer:
				return h.handleAnswer(peerConnection, message.Data, clientID, roomID)
			case types.EventKeepAlive:
					if h.config.Debug {
						h.debugLog("💓 Keep-alive received from %s", clientID)
					}
					return nil
				default:
					h.debugLog("❓ Unknown message event from %s: %s", clientID, message.Event)
					return nil
				}
			})

			if err != nil {
				h.debugLog("❌ Error processing message from %s: %v", clientID, err)
			}
		}

		h.debugLog("📨 Message handling ended for client %s (Total messages: %d)", clientID, messageCount)
		return nil
	})
}

// handleICECandidate processes ICE candidate messages
func (h *Handler) handleICECandidate(peerConnection *webrtc.PeerConnection, data, clientID string) error {
	candidate := webrtc.ICECandidateInit{}
	if err := recovery.SafeJSONUnmarshal([]byte(data), &candidate); err != nil {
		h.debugLog("❌ Error unmarshalling ICE candidate from %s: %v", clientID, err)
		return err
	}

	h.debugLog("🔧 Adding ICE candidate from %s", clientID)
	if err := peerConnection.AddICECandidate(candidate); err != nil {
		h.debugLog("❌ Error adding ICE candidate from %s: %v", clientID, err)
		return err
	}
	return nil
}

// handleAnswer processes answer messages and triggers re-signaling to
// distribute any tracks that arrived while this peer was in have-local-offer.
func (h *Handler) handleAnswer(peerConnection *webrtc.PeerConnection, data, clientID, roomID string) error {
	answer := webrtc.SessionDescription{}
	if err := recovery.SafeJSONUnmarshal([]byte(data), &answer); err != nil {
		h.debugLog("❌ Error unmarshalling answer from %s: %v", clientID, err)
		return err
	}

	h.debugLog("🔄 Setting remote description (answer) from %s", clientID)
	if err := peerConnection.SetRemoteDescription(answer); err != nil {
		h.debugLog("❌ Error setting remote description from %s: %v", clientID, err)
		return err
	}

	// Signaling state is now stable again. Re-signal the room so that any
	// tracks that arrived while this peer was in have-local-offer get added
	// and offered. This is safe because processPeerConnection only creates
	// an offer when there are actual track changes (no infinite loop).
	go h.coordinator.SignalPeerConnectionsInRoom(roomID)
	return nil
}

// sendErrorToConnection sends an error message to a WebSocket connection
func (h *Handler) sendErrorToConnection(conn *ThreadSafeWriter, errorMsg string) {
	recovery.SafeExecute("WEBSOCKET", "SEND_ERROR", func() error {
		h.debugLog("❌ Sending error: %s", errorMsg)
		return conn.WriteJSON(&types.WebSocketMessage{
			Event: types.EventRoomError,
			Data:  errorMsg,
		})
	})
}

// sendSuccessToConnection sends a success message to a WebSocket connection
func (h *Handler) sendSuccessToConnection(conn *ThreadSafeWriter, successMsg string) {
	recovery.SafeExecute("WEBSOCKET", "SEND_SUCCESS", func() error {
		h.debugLog("✅ Sending success: %s", successMsg)
		return conn.WriteJSON(&types.WebSocketMessage{
			Event: types.EventRoomJoined,
			Data:  successMsg,
		})
	})
}
