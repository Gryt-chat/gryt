package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"time"

	pion "github.com/pion/webrtc/v3"

	"sfu-v2/internal/config"
	"sfu-v2/internal/recovery"
	"sfu-v2/internal/room"
	"sfu-v2/internal/signaling"
	"sfu-v2/internal/track"
	webrtcmanager "sfu-v2/internal/webrtc"
	"sfu-v2/internal/websocket"
)

func main() {
	// Set up global panic recovery
	defer func() {
		if r := recover(); r != nil {
			log.Printf("🚨 FATAL PANIC in main(): %v", r)
			recovery.GetLogger().DumpRecentActions()
			log.Fatalf("🚨 Server crashed with panic: %v", r)
		}
	}()

	// Parse command-line flags
	flag.Parse()

	// Set logging options
	log.SetFlags(log.LstdFlags | log.Lshortfile)

	// Initialize recovery system
	logger := recovery.GetLogger()
	logger.LogAction("MAIN", "STARTUP", "", "", "SFU Server starting")

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		logger.LogAction("MAIN", "CONFIG_ERROR", "", "", err.Error())
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Log startup information
	log.Printf("🚀 Starting SFU Server")
	log.Printf("📊 Configuration: Port=%s, Debug=%t, VerboseLog=%t", cfg.Port, cfg.Debug, cfg.VerboseLog)
	log.Printf("🧊 ICE Servers: %v", cfg.STUNServers)

	if cfg.Debug {
		log.Printf("🔍 Debug mode enabled - detailed logging active")
	}

	if cfg.VerboseLog {
		log.Printf("📝 Verbose logging enabled - RTP packet logging active")
	}

	// Start system monitoring
	recovery.StartSystemMonitor(30 * time.Second) // Monitor every 30 seconds
	logger.LogAction("MAIN", "MONITOR_STARTED", "", "", "System monitoring active")

	// Initialize managers with crash protection
	log.Printf("🏗️  Initializing components...")

	var trackManager *track.Manager
	var webrtcManager *webrtcmanager.Manager
	var roomManager *room.Manager
	var coordinator *signaling.Coordinator
	var webrtcAPI *pion.API

	// Initialize track manager with recovery
	err = recovery.SafeExecute("MAIN", "INIT_TRACK_MANAGER", func() error {
		trackManager = track.NewManager(cfg.Debug)
		log.Printf("✅ Track manager initialized (debug: %t)", cfg.Debug)
		return nil
	})
	if err != nil {
		log.Fatalf("❌ Failed to initialize track manager: %v", err)
	}

	// Initialize WebRTC manager with recovery
	err = recovery.SafeExecute("MAIN", "INIT_WEBRTC_MANAGER", func() error {
		webrtcManager = webrtcmanager.NewManager(cfg.Debug)
		log.Printf("✅ WebRTC manager initialized (debug: %t)", cfg.Debug)
		return nil
	})
	if err != nil {
		log.Fatalf("❌ Failed to initialize WebRTC manager: %v", err)
	}

	// Build a Pion WebRTC API with a configured SettingEngine (UDP port range, advertised IP, etc.)
	err = recovery.SafeExecute("MAIN", "INIT_WEBRTC_API", func() error {
		se := pion.SettingEngine{}
		if cfg.ICEUDPPortMin > 0 && cfg.ICEUDPPortMax >= cfg.ICEUDPPortMin && cfg.ICEUDPPortMax <= 65535 {
			se.SetEphemeralUDPPortRange(uint16(cfg.ICEUDPPortMin), uint16(cfg.ICEUDPPortMax))
			log.Printf("🧊 ICE UDP port range pinned: %d-%d", cfg.ICEUDPPortMin, cfg.ICEUDPPortMax)
		}
		if cfg.ICEAdvertiseIP != "" {
			// Rewrite host candidates to this IP (useful when behind NAT / when you only want a specific public IP advertised)
			se.SetNAT1To1IPs([]string{cfg.ICEAdvertiseIP}, pion.ICECandidateTypeHost)
			log.Printf("🧊 ICE advertise IP set: %s", cfg.ICEAdvertiseIP)
		}
		me := &pion.MediaEngine{}
		if err := me.RegisterDefaultCodecs(); err != nil {
			return fmt.Errorf("failed to register default codecs: %w", err)
		}
		webrtcAPI = pion.NewAPI(pion.WithSettingEngine(se), pion.WithMediaEngine(me))
		return nil
	})
	if err != nil {
		log.Fatalf("❌ Failed to initialize WebRTC API: %v", err)
	}

	// Initialize room manager with recovery
	err = recovery.SafeExecute("MAIN", "INIT_ROOM_MANAGER", func() error {
		roomManager = room.NewManager(cfg.Debug)
		log.Printf("✅ Room manager initialized (debug: %t)", cfg.Debug)
		return nil
	})
	if err != nil {
		log.Fatalf("❌ Failed to initialize room manager: %v", err)
	}

	// Initialize signaling coordinator with recovery
	err = recovery.SafeExecute("MAIN", "INIT_COORDINATOR", func() error {
		coordinator = signaling.NewCoordinator(trackManager, webrtcManager, roomManager, cfg.Debug)
		log.Printf("✅ Signaling coordinator initialized (debug: %t)", cfg.Debug)
		return nil
	})
	if err != nil {
		log.Fatalf("❌ Failed to initialize signaling coordinator: %v", err)
	}

	// Initialize WebSocket handler with recovery
	var wsHandler *websocket.Handler
	err = recovery.SafeExecute("MAIN", "INIT_WEBSOCKET_HANDLER", func() error {
		wsHandler = websocket.NewHandler(cfg, webrtcAPI, trackManager, webrtcManager, roomManager, coordinator)
		log.Printf("✅ WebSocket handler initialized")
		return nil
	})
	if err != nil {
		log.Fatalf("❌ Failed to initialize WebSocket handler: %v", err)
	}


	// Start room cleanup routine with recovery
	recovery.SafeGoroutine("MAIN", "ROOM_CLEANUP", func() {
		ticker := time.NewTicker(5 * time.Minute) // Check every 5 minutes
		defer ticker.Stop()

		log.Printf("🧹 Room cleanup routine started (check interval: 5m, cleanup threshold: 30m)")

		for range ticker.C {
			recovery.SafeExecute("ROOM_CLEANUP", "CLEANUP_CYCLE", func() error {
				if cfg.Debug {
					log.Printf("🧹 Running scheduled room cleanup...")
				}
				roomManager.CleanupEmptyRooms(30 * time.Minute) // Remove rooms empty for 30+ minutes
				return nil
			})
		}
	})

	// Add health check endpoint for monitoring systems
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"healthy","service":"sfu","timestamp":"` + time.Now().Format(time.RFC3339) + `"}`))
	})

	// Handle WebSocket connections with recovery wrapper
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Check if this is a WebSocket upgrade request
		if r.Header.Get("Upgrade") == "websocket" && r.Header.Get("Connection") != "" {
			recovery.SafeExecuteWithContext("WEBSOCKET", "HANDLE_CONNECTION", "", "", r.RemoteAddr, func() error {
				wsHandler.HandleWebSocket(w, r)
				return nil
			})
		} else {
			// Handle non-WebSocket requests (health checks, monitoring, etc.)
			log.Printf("📋 Non-WebSocket request from %s: %s %s (User-Agent: %s)",
				r.RemoteAddr, r.Method, r.URL.Path, r.Header.Get("User-Agent"))

			// Return a helpful response for non-WebSocket requests
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte("This endpoint only accepts WebSocket connections. Use /health for health checks."))
		}
	})

	log.Printf("✅ Endpoints configured:")
	log.Printf("   📡 / (WebSocket client endpoint)")
	log.Printf("   📡 /client (explicit WebSocket client endpoint)")
	log.Printf("   📡 /server (WebSocket server registration endpoint)")
	log.Printf("   🏥 /health (HTTP health check endpoint)")

	// Log initial system stats
	recovery.LogSystemStats()

	// Start the HTTP server with recovery
	log.Printf("🌐 Starting HTTP server on port %s", cfg.Port)
	log.Printf("🎯 SFU Server ready!")
	log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	logger.LogAction("MAIN", "SERVER_READY", "", "", "HTTP server starting on port "+cfg.Port)

	if err := http.ListenAndServe(":"+cfg.Port, nil); err != nil {
		logger.LogAction("MAIN", "SERVER_ERROR", "", "", err.Error())
		log.Fatalf("❌ HTTP server failed: %v", err)
	}
}
