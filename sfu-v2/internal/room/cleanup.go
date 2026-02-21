package room

import (
	"fmt"
	"time"

	"sfu-v2/internal/recovery"
)

// CleanupEmptyRooms removes rooms that have been empty for longer than maxIdleTime
func (m *Manager) CleanupEmptyRooms(maxIdleTime time.Duration) {
	recovery.SafeExecuteWithContext("ROOM_MANAGER", "CLEANUP_ROOMS", "", "", fmt.Sprintf("Max idle: %v", maxIdleTime), func() error {
		m.mutex.Lock()
		defer m.mutex.Unlock()

		now := time.Now()
		roomsToDelete := []string{}
		serversToUpdate := map[string][]string{}

		// Find rooms to delete
		for roomID, room := range m.rooms {
			recovery.SafeExecuteWithContext("ROOM_MANAGER", "CHECK_ROOM", "", roomID, "Checking room for cleanup", func() error {
				room.mutex.RLock()
				defer room.mutex.RUnlock()

				isEmpty := len(room.PeerConnections) == 0
				isIdle := now.Sub(room.LastActivity) > maxIdleTime

				if isEmpty && isIdle {
					roomsToDelete = append(roomsToDelete, roomID)
					m.debugLog("🗑️  Room '%s' marked for deletion (empty for %v)", roomID, now.Sub(room.LastActivity))
				} else if m.debug {
					m.debugLog("🏠 Room '%s' kept (peers: %d, idle: %v)", roomID, len(room.PeerConnections), now.Sub(room.LastActivity))
				}
				return nil
			})
		}

		// Delete marked rooms
		for _, roomID := range roomsToDelete {
			recovery.SafeExecuteWithContext("ROOM_MANAGER", "DELETE_ROOM", "", roomID, "Deleting empty room", func() error {
				room := m.rooms[roomID]
				serverID := room.ServerID

				delete(m.rooms, roomID)

				// Update server-to-rooms mapping
				if rooms, exists := m.serverToRooms[serverID]; exists {
					newRooms := []string{}
					for _, rid := range rooms {
						if rid != roomID {
							newRooms = append(newRooms, rid)
						}
					}
					if len(newRooms) == 0 {
						delete(m.serverToRooms, serverID)
					} else {
						m.serverToRooms[serverID] = newRooms
					}
					serversToUpdate[serverID] = newRooms
				}

				m.debugLog("🗑️  Deleted empty room '%s' from server '%s'", roomID, serverID)
				return nil
			})
		}

		if len(roomsToDelete) > 0 {
			m.debugLog("🧹 Cleanup completed: deleted %d rooms, %d total rooms remaining", len(roomsToDelete), len(m.rooms))
			m.logRoomStats()
		}

		return nil
	})
}

// logRoomStats logs current room statistics
func (m *Manager) logRoomStats() {
	recovery.SafeExecute("ROOM_MANAGER", "LOG_STATS", func() error {
		if !m.debug {
			return nil
		}

		totalPeers := 0
		for _, room := range m.rooms {
			room.mutex.RLock()
			totalPeers += len(room.PeerConnections)
			room.mutex.RUnlock()
		}

		m.debugLog("📊 Room Stats: %d rooms, %d servers, %d total peers",
			len(m.rooms), len(m.registeredServers), totalPeers)
		return nil
	})
}

// logRoomDetails logs detailed information about a specific room
func (m *Manager) logRoomDetails(room *Room) {
	recovery.SafeExecuteWithContext("ROOM_MANAGER", "LOG_ROOM_DETAILS", "", room.ID, "Logging room details", func() error {
		if !m.debug {
			return nil
		}

		// Note: room.mutex should already be locked by caller
		m.debugLog("🏠 Room '%s' details: Server=%s, Peers=%d, Connections=%d, Created=%v, LastActivity=%v",
			room.ID, room.ServerID, len(room.PeerConnections), len(room.Connections),
			room.CreatedAt.Format("15:04:05"), room.LastActivity.Format("15:04:05"))
		return nil
	})
}
