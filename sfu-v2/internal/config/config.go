package config

import (
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
	"github.com/pion/webrtc/v3"
)

// Config holds the application configuration
type Config struct {
	Port        string
	STUNServers []string
	ICEServers  []webrtc.ICEServer
	Debug       bool
	VerboseLog  bool

	// WebRTC / ICE networking
	ICEUDPPortMin int
	ICEUDPPortMax int
	ICEAdvertiseIP string
	DisableSTUN    bool

	// Capacity guardrail (primarily to match UDP port range)
	MaxPeers int
}

// Load reads configuration from environment variables
func Load() (*Config, error) {
	err := godotenv.Load()
	if err != nil {
		log.Printf("Warning: Error loading .env file: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "5005"
	}

	disableSTUN, _ := strconv.ParseBool(os.Getenv("DISABLE_STUN"))

	stunServers := strings.Split(os.Getenv("STUN_SERVERS"), ",")
	if len(stunServers) == 1 && stunServers[0] == "" {
		// Default STUN servers if none provided
		stunServers = []string{"stun:stun.l.google.com:19302"}
	}

	iceServers := []webrtc.ICEServer{}
	if !disableSTUN {
		iceServers = []webrtc.ICEServer{
			{
				URLs: stunServers,
			},
		}
	}

	iceUDPPortMin, _ := strconv.Atoi(os.Getenv("ICE_UDP_PORT_MIN"))
	iceUDPPortMax, _ := strconv.Atoi(os.Getenv("ICE_UDP_PORT_MAX"))
	iceAdvertiseIP := os.Getenv("ICE_ADVERTISE_IP")

	maxPeers, _ := strconv.Atoi(os.Getenv("MAX_PEERS"))
	if maxPeers <= 0 && iceUDPPortMin > 0 && iceUDPPortMax >= iceUDPPortMin {
		// Default capacity to the size of the pinned UDP port range.
		maxPeers = (iceUDPPortMax - iceUDPPortMin + 1)
	}

	// Debug configuration
	debug, _ := strconv.ParseBool(os.Getenv("DEBUG"))
	verboseLog, _ := strconv.ParseBool(os.Getenv("VERBOSE_LOG"))

	// Default to debug mode if not specified
	if os.Getenv("DEBUG") == "" {
		debug = true
	}

	return &Config{
		Port:        port,
		STUNServers: stunServers,
		ICEServers:  iceServers,
		Debug:       debug,
		VerboseLog:  verboseLog,
		ICEUDPPortMin: iceUDPPortMin,
		ICEUDPPortMax: iceUDPPortMax,
		ICEAdvertiseIP: iceAdvertiseIP,
		DisableSTUN:    disableSTUN,
		MaxPeers:       maxPeers,
	}, nil
}
