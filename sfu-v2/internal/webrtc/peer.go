package webrtc

import (
	"log"
	"sync"

	"github.com/pion/webrtc/v3"
)

// WebSocketWriter interface to avoid circular imports
type WebSocketWriter interface {
	WriteJSON(v interface{}) error
}

// PeerConnection represents a WebRTC peer connection with its associated WebSocket
type PeerConnection struct {
	PC        *webrtc.PeerConnection
	WebSocket WebSocketWriter
}

// Manager handles multiple peer connections per room
type Manager struct {
	mu sync.RWMutex
	// Map of roomID -> clientID -> PeerConnection
	roomPeers map[string]map[string]PeerConnection
	debug     bool
}

// NewManager creates a new WebRTC peer connection manager
func NewManager(debug bool) *Manager {
	return &Manager{
		roomPeers: make(map[string]map[string]PeerConnection),
		debug:     debug,
	}
}

// debugLog logs debug messages if debug mode is enabled
func (m *Manager) debugLog(format string, args ...interface{}) {
	if m.debug {
		log.Printf("[WEBRTC-MANAGER] "+format, args...)
	}
}

// AddPeerToRoom adds a new peer connection to a specific room
func (m *Manager) AddPeerToRoom(roomID, clientID string, pc *webrtc.PeerConnection, ws WebSocketWriter) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Initialize room if it doesn't exist
	if m.roomPeers[roomID] == nil {
		m.roomPeers[roomID] = make(map[string]PeerConnection)
		m.debugLog("🏠 Initialized peer storage for room '%s'", roomID)
	}

	// Add peer to room
	m.roomPeers[roomID][clientID] = PeerConnection{
		PC:        pc,
		WebSocket: ws,
	}

	roomPeerCount := len(m.roomPeers[roomID])
	m.debugLog("🔗 Added peer '%s' to room '%s' (Room peers: %d)", clientID, roomID, roomPeerCount)
}

// RemovePeerFromRoom removes a peer connection from a specific room
func (m *Manager) RemovePeerFromRoom(roomID, clientID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	roomPeers, roomExists := m.roomPeers[roomID]
	if !roomExists {
		m.debugLog("❌ Cannot remove peer: room '%s' does not exist", roomID)
		return
	}

	if _, peerExists := roomPeers[clientID]; !peerExists {
		m.debugLog("❌ Peer '%s' not found in room '%s'", clientID, roomID)
		return
	}

	delete(roomPeers, clientID)
	m.debugLog("🗑️  Removed peer '%s' from room '%s' (Remaining peers: %d)", clientID, roomID, len(roomPeers))

	// Clean up empty room
	if len(roomPeers) == 0 {
		delete(m.roomPeers, roomID)
		m.debugLog("🧹 Cleaned up empty peer storage for room '%s'", roomID)
	}
}

// GetPeersInRoom returns a copy of all peer connections in a specific room
func (m *Manager) GetPeersInRoom(roomID string) []PeerConnection {
	m.mu.RLock()
	defer m.mu.RUnlock()

	roomPeers, exists := m.roomPeers[roomID]
	if !exists {
		m.debugLog("📭 No peers found for room '%s'", roomID)
		return []PeerConnection{}
	}

	peers := make([]PeerConnection, 0, len(roomPeers))
	for _, peer := range roomPeers {
		peers = append(peers, peer)
	}

	m.debugLog("📦 Retrieved %d peers from room '%s'", len(peers), roomID)
	return peers
}

// RemoveClosedPeersInRoom removes peer connections that are closed from a specific room
func (m *Manager) RemoveClosedPeersInRoom(roomID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	roomPeers, exists := m.roomPeers[roomID]
	if !exists {
		return
	}

	removedCount := 0
	for clientID, peer := range roomPeers {
		if peer.PC.ConnectionState() == webrtc.PeerConnectionStateClosed {
			delete(roomPeers, clientID)
			removedCount++
			m.debugLog("🗑️  Removed closed peer '%s' from room '%s'", clientID, roomID)
		}
	}

	if removedCount > 0 {
		m.debugLog("🧹 Removed %d closed peers from room '%s'", removedCount, roomID)
	}

	// Clean up empty room
	if len(roomPeers) == 0 {
		delete(m.roomPeers, roomID)
		m.debugLog("🧹 Cleaned up empty peer storage for room '%s'", roomID)
	}
}

// GetRoomStats returns statistics about peers per room
func (m *Manager) GetRoomStats() map[string]int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	stats := make(map[string]int)
	for roomID, peers := range m.roomPeers {
		stats[roomID] = len(peers)
	}
	return stats
}

// CreatePeerConnection creates a new WebRTC peer connection with the given configuration
func CreatePeerConnection(api *webrtc.API, config webrtc.Configuration) (*webrtc.PeerConnection, error) {
	if api == nil {
		api = webrtc.NewAPI()
	}

	peerConnection, err := api.NewPeerConnection(config)
	if err != nil {
		return nil, err
	}

	if _, err := peerConnection.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	}); err != nil {
		return nil, err
	}

	return peerConnection, nil
}


