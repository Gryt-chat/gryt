package track

import (
	"log"
	"sync"

	"github.com/pion/webrtc/v3"
)

// Manager handles the lifecycle of media tracks per room
type Manager struct {
	mu sync.RWMutex
	// Map of roomID -> trackID -> track
	roomTracks map[string]map[string]*webrtc.TrackLocalStaticRTP
	debug      bool
}

// NewManager creates a new track manager
func NewManager(debug bool) *Manager {
	return &Manager{
		roomTracks: make(map[string]map[string]*webrtc.TrackLocalStaticRTP),
		debug:      debug,
	}
}

// debugLog logs debug messages if debug mode is enabled
func (m *Manager) debugLog(format string, args ...interface{}) {
	if m.debug {
		log.Printf("[TRACK-MANAGER] "+format, args...)
	}
}

// AddTrackToRoom adds a new media track to a specific room
func (m *Manager) AddTrackToRoom(roomID string, t *webrtc.TrackRemote) *webrtc.TrackLocalStaticRTP {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Create a new local track with the same codec as the incoming remote track
	trackLocal, err := webrtc.NewTrackLocalStaticRTP(t.Codec().RTPCodecCapability, t.ID(), t.StreamID())
	if err != nil {
		m.debugLog("❌ Error creating local track for room '%s': %v", roomID, err)
		return nil
	}

	// Initialize room tracks map if it doesn't exist
	if m.roomTracks[roomID] == nil {
		m.roomTracks[roomID] = make(map[string]*webrtc.TrackLocalStaticRTP)
		m.debugLog("🏠 Initialized track storage for room '%s'", roomID)
	}

	// Store the local track in the room
	m.roomTracks[roomID][t.ID()] = trackLocal

	roomTrackCount := len(m.roomTracks[roomID])
	m.debugLog("🎵 Added track to room '%s': ID=%s, StreamID=%s, Kind=%s (Room tracks: %d)",
		roomID, t.ID(), t.StreamID(), t.Kind().String(), roomTrackCount)

	return trackLocal
}

// RemoveTrackFromRoom removes a media track from a specific room
func (m *Manager) RemoveTrackFromRoom(roomID string, t *webrtc.TrackLocalStaticRTP) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if the room exists
	roomTracks, roomExists := m.roomTracks[roomID]
	if !roomExists {
		m.debugLog("❌ Cannot remove track: room '%s' does not exist", roomID)
		return
	}

	// Check if the track exists
	if t == nil || roomTracks[t.ID()] == nil {
		m.debugLog("❌ Track or track ID not found in room '%s'", roomID)
		return
	}

	// Remove the track from the room
	delete(roomTracks, t.ID())
	m.debugLog("🗑️  Removed track from room '%s': ID=%s (Remaining tracks: %d)",
		roomID, t.ID(), len(roomTracks))

	// Clean up empty room track storage
	if len(roomTracks) == 0 {
		delete(m.roomTracks, roomID)
		m.debugLog("🧹 Cleaned up empty track storage for room '%s'", roomID)
	}
}

// GetTracksInRoom returns a copy of all tracks in a specific room
func (m *Manager) GetTracksInRoom(roomID string) map[string]*webrtc.TrackLocalStaticRTP {
	m.mu.RLock()
	defer m.mu.RUnlock()

	roomTracks, exists := m.roomTracks[roomID]
	if !exists {
		m.debugLog("📭 No tracks found for room '%s'", roomID)
		return make(map[string]*webrtc.TrackLocalStaticRTP)
	}

	// Create a copy to avoid race conditions
	tracks := make(map[string]*webrtc.TrackLocalStaticRTP)
	for id, track := range roomTracks {
		tracks[id] = track
	}

	m.debugLog("📦 Retrieved %d tracks from room '%s'", len(tracks), roomID)
	return tracks
}

// GetTrackInRoom returns a specific track by ID from a specific room
func (m *Manager) GetTrackInRoom(roomID, trackID string) (*webrtc.TrackLocalStaticRTP, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	roomTracks, roomExists := m.roomTracks[roomID]
	if !roomExists {
		return nil, false
	}

	track, exists := roomTracks[trackID]
	return track, exists
}

// GetRoomStats returns statistics about tracks per room
func (m *Manager) GetRoomStats() map[string]int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	stats := make(map[string]int)
	for roomID, tracks := range m.roomTracks {
		stats[roomID] = len(tracks)
	}
	return stats
}

// CleanupEmptyRooms removes track storage for rooms with no tracks
func (m *Manager) CleanupEmptyRooms() {
	m.mu.Lock()
	defer m.mu.Unlock()

	cleanedRooms := 0
	for roomID, tracks := range m.roomTracks {
		if len(tracks) == 0 {
			delete(m.roomTracks, roomID)
			cleanedRooms++
			m.debugLog("🧹 Cleaned up empty track storage for room '%s'", roomID)
		}
	}

	if cleanedRooms > 0 {
		m.debugLog("🧹 Cleaned up %d empty room track storages", cleanedRooms)
	}
}

