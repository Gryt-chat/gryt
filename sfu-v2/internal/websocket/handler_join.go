package websocket

import (
	"fmt"
	"net/http"

	"github.com/pion/webrtc/v3"

	"sfu-v2/internal/recovery"
	peerManager "sfu-v2/internal/webrtc"
	"sfu-v2/pkg/types"
)

// handleClientConnection handles client WebRTC connections
func (h *Handler) handleClientConnection(conn *ThreadSafeWriter, clientID string, r *http.Request) error {
	return recovery.SafeExecuteWithContext("WEBSOCKET", "HANDLE_CLIENT", clientID, "", "Client connection handling", func() error {
		h.debugLog("👤 Client connection established: %s", clientID)

		// Wait for client join message with room information
		var raw []byte
		var err error

		err = recovery.SafeExecuteWithContext("WEBSOCKET", "READ_CLIENT_JOIN", clientID, "", "Reading initial client message", func() error {
			_, raw, err = conn.ReadMessage()
			return err
		})

		if err != nil {
			h.debugLog("❌ Error reading initial client message from %s: %v", clientID, err)
			return err
		}

		message := &types.WebSocketMessage{}
		if err := recovery.SafeJSONUnmarshal(raw, &message); err != nil {
			h.debugLog("❌ Error unmarshalling initial client message from %s: %v", clientID, err)
			return err
		}

		h.debugLog("📨 Client initial message from %s: event=%s", clientID, message.Event)

		if message.Event != types.EventClientJoin {
			h.debugLog("❌ Expected client_join event from %s, got: %s", clientID, message.Event)
			h.sendErrorToConnection(conn, "Expected client_join event")
			return fmt.Errorf("expected client_join event, got: %s", message.Event)
		}

		var joinData types.ClientJoinData
		if err := recovery.SafeJSONUnmarshal([]byte(message.Data), &joinData); err != nil {
			h.debugLog("❌ Error unmarshalling client join data from %s: %v", clientID, err)
			h.sendErrorToConnection(conn, "Invalid join data")
			return err
		}

		h.debugLog("👤 Client %s attempting to join room '%s' (Server: %s)", clientID, joinData.RoomID, joinData.ServerID)

		// Validate client can join the room
		if err := h.roomManager.ValidateClientJoin(joinData.RoomID, joinData.ServerID, joinData.ServerPassword); err != nil {
			h.debugLog("❌ Client join validation failed for %s: %v", clientID, err)
			h.sendErrorToConnection(conn, "Join validation failed: "+err.Error())
			return err
		}

		h.debugLog("✅ Client %s validated for room '%s'", clientID, joinData.RoomID)

		// Capacity guardrail: prevent accepting more peers than the SFU can reliably bind
		// (primarily tied to the configured ICE UDP port range).
		if h.config.MaxPeers > 0 {
			currentPeers := h.roomManager.TotalPeers()
			if currentPeers >= h.config.MaxPeers {
				msg := fmt.Sprintf("Sorry, there are no seats left in this voice server (%d/%d). Try again later.", currentPeers, h.config.MaxPeers)
				h.debugLog("🚫 Rejecting client %s: capacity reached (%d/%d)", clientID, currentPeers, h.config.MaxPeers)
				h.sendErrorToConnection(conn, msg)
				return fmt.Errorf("server full: %d/%d", currentPeers, h.config.MaxPeers)
			}
		}

		// Create WebRTC peer connection with recovery
		var peerConnection *webrtc.PeerConnection
		err = recovery.SafeExecuteWithContext("WEBSOCKET", "CREATE_PEER_CONNECTION", clientID, joinData.RoomID, "Creating WebRTC peer connection", func() error {
			config := webrtc.Configuration{
				ICEServers: h.config.ICEServers,
			}

			var createErr error
			peerConnection, createErr = peerManager.CreatePeerConnection(h.webrtcAPI, config)
			if createErr != nil {
				h.debugLog("❌ Error creating WebRTC peer connection for %s: %v", clientID, createErr)
				h.sendErrorToConnection(conn, "Failed to create peer connection")
				return createErr
			}

			h.debugLog("🔗 Created WebRTC peer connection for client %s", clientID)
			return nil
		})

		if err != nil {
			return err
		}

		// Ensure peer connection cleanup
		defer func() {
			recovery.SafeExecuteWithContext("WEBSOCKET", "CLEANUP_PEER_CONNECTION", clientID, joinData.RoomID, "Cleaning up peer connection", func() error {
				if peerConnection != nil {
					peerConnection.Close()
				}
				return nil
			})
		}()

		// Add peer to room managers with recovery
		err = recovery.SafeExecuteWithContext("WEBSOCKET", "ADD_PEER_TO_ROOM", clientID, joinData.RoomID, "Adding peer to room", func() error {
			if err := h.roomManager.AddPeerToRoom(joinData.RoomID, clientID, peerConnection, conn); err != nil {
				h.debugLog("❌ Error adding peer %s to room %s: %v", clientID, joinData.RoomID, err)
				h.sendErrorToConnection(conn, "Failed to join room")
				return err
			}

			h.webrtcManager.AddPeerToRoom(joinData.RoomID, clientID, peerConnection, conn)
			return nil
		})

		if err != nil {
			return err
		}

		// Remove peer from both managers on disconnect
		defer func() {
			recovery.SafeExecuteWithContext("WEBSOCKET", "REMOVE_PEER_FROM_ROOM", clientID, joinData.RoomID, "Removing peer from room", func() error {
				h.debugLog("🚪 Client %s leaving room '%s'", clientID, joinData.RoomID)
				h.roomManager.RemovePeerFromRoom(joinData.RoomID, clientID)
				h.webrtcManager.RemovePeerFromRoom(joinData.RoomID, clientID)
				h.coordinator.SignalPeerConnectionsInRoom(joinData.RoomID)
				return nil
			})
		}()

		// Send success message
		h.debugLog("✅ Client %s successfully joined room '%s'", clientID, joinData.RoomID)
		h.sendSuccessToConnection(conn, "Successfully joined room")

		// Set up WebRTC event handlers with recovery
		h.setupWebRTCHandlers(peerConnection, conn, clientID, joinData.RoomID)

		// Signal the new peer connection to start the negotiation process
		recovery.SafeExecuteWithContext("WEBSOCKET", "SIGNAL_PEER_CONNECTIONS", clientID, joinData.RoomID, "Starting peer signaling", func() error {
			h.debugLog("🔄 Starting peer connection signaling for %s in room '%s'", clientID, joinData.RoomID)
			h.coordinator.SignalPeerConnectionsInRoom(joinData.RoomID)
			return nil
		})

		// Handle incoming WebSocket messages from the client
		return h.handleClientMessages(conn, peerConnection, joinData.RoomID, clientID)
	})
}

// setupWebRTCHandlers sets up WebRTC event handlers with crash protection
func (h *Handler) setupWebRTCHandlers(peerConnection *webrtc.PeerConnection, conn *ThreadSafeWriter, clientID, roomID string) {
	// Set up ICE candidate handling with recovery
	peerConnection.OnICECandidate(func(i *webrtc.ICECandidate) {
		recovery.SafeExecuteWithContext("WEBRTC", "ICE_CANDIDATE", clientID, roomID, "Handling ICE candidate", func() error {
			if i == nil {
				h.debugLog("🔧 ICE gathering complete for %s (nil candidate sentinel)", clientID)
				return nil
			}

			h.debugLog("🔧 ICE candidate for %s: type=%s protocol=%s address=%s:%d",
				clientID, i.Typ.String(), i.Protocol.String(), i.Address, i.Port)

			candidateString, err := recovery.SafeJSONMarshal(i.ToJSON())
			if err != nil {
				h.debugLog("❌ Error marshalling ICE candidate for %s: %v", clientID, err)
				return err
			}

			if writeErr := conn.WriteJSON(&types.WebSocketMessage{
				Event: types.EventCandidate,
				Data:  string(candidateString),
			}); writeErr != nil {
				h.debugLog("❌ Error sending candidate JSON to %s: %v", clientID, writeErr)
				return writeErr
			}
			return nil
		})
	})

	// Handle connection state changes with recovery
	peerConnection.OnConnectionStateChange(func(p webrtc.PeerConnectionState) {
		recovery.SafeExecuteWithContext("WEBRTC", "CONNECTION_STATE_CHANGE", clientID, roomID, p.String(), func() error {
			h.debugLog("🔗 Peer state change %s: connection=%s ICE=%s signaling=%s gathering=%s",
				clientID, p.String(),
				peerConnection.ICEConnectionState().String(),
				peerConnection.SignalingState().String(),
				peerConnection.ICEGatheringState().String())
			switch p {
			case webrtc.PeerConnectionStateFailed:
				h.debugLog("❌ Peer connection failed for %s", clientID)
				if err := peerConnection.Close(); err != nil {
					h.debugLog("❌ Peer connection failed to close for %s: %v", clientID, err)
				}
			case webrtc.PeerConnectionStateClosed:
				h.debugLog("🔌 Peer connection closed for %s", clientID)
				h.coordinator.SignalPeerConnectionsInRoom(roomID)
			case webrtc.PeerConnectionStateConnected:
				h.debugLog("✅ Peer connection established for %s in room '%s'", clientID, roomID)
			}
			return nil
		})
	})

	// Handle incoming tracks with recovery
	peerConnection.OnTrack(func(t *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		recovery.SafeExecuteWithContext("WEBRTC", "TRACK_RECEIVED", clientID, roomID, fmt.Sprintf("Track: %s", t.Kind().String()), func() error {
			h.debugLog("🎵 Incoming track from %s in room '%s': %s (SSRC: %d)", clientID, roomID, t.Kind().String(), t.SSRC())

			trackLocal := h.trackManager.AddTrackToRoom(roomID, t)
			if trackLocal == nil {
				h.debugLog("❌ Failed to create local track for %s", clientID)
				return fmt.Errorf("failed to create local track")
			}

			defer func() {
				recovery.SafeExecuteWithContext("WEBRTC", "CLEANUP_TRACK", clientID, roomID, "Cleaning up track", func() error {
					h.trackManager.RemoveTrackFromRoom(roomID, trackLocal)
					h.coordinator.OnTrackRemovedFromRoom(roomID)
					return nil
				})
			}()

			h.debugLog("🎵 Created local track for forwarding from %s", clientID)

			h.coordinator.OnTrackAddedToRoom(roomID)

			return h.forwardRTPPackets(t, trackLocal, clientID)
		})
	})
}

// forwardRTPPackets forwards RTP packets from remote track to local track
func (h *Handler) forwardRTPPackets(remoteTrack *webrtc.TrackRemote, localTrack *webrtc.TrackLocalStaticRTP, clientID string) error {
	buf := make([]byte, 1500)
	rtpPacketCount := 0

	for {
		var i int
		var readErr error

		err := recovery.SafeExecuteWithContext("WEBRTC", "READ_RTP_PACKET", clientID, "", "Reading RTP packet", func() error {
			i, _, readErr = remoteTrack.Read(buf)
			return readErr
		})

		if err != nil {
			h.debugLog("🎵 Track read ended for %s: %v", clientID, err)
			return err
		}

		err = recovery.SafeExecuteWithContext("WEBRTC", "WRITE_RTP_PACKET", clientID, "", "Writing RTP packet", func() error {
			_, writeErr := localTrack.Write(buf[:i])
			return writeErr
		})

		if err != nil {
			h.debugLog("❌ Track write error for %s: %v", clientID, err)
			return err
		}

		rtpPacketCount++
		if h.config.VerboseLog && rtpPacketCount%1000 == 0 {
			h.debugLog("🎵 Forwarded %d RTP packets from %s", rtpPacketCount, clientID)
		}
	}
}
