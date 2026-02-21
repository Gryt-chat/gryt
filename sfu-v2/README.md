# 🚀 Gryt SFU v2 - Selective Forwarding Unit

The Gryt SFU (Selective Forwarding Unit) is a high-performance Go-based WebRTC media server that efficiently forwards audio streams between participants. Built with Pion WebRTC, it provides enterprise-grade voice communication with minimal latency and optimal bandwidth usage.

## ✨ Features

### 🎙️ **Media Forwarding**
- **Selective Forwarding**: Efficiently routes audio streams without transcoding
- **Multi-participant Support**: Handles multiple users in voice channels simultaneously  
- **Low Latency**: Optimized for real-time voice communication
- **Bandwidth Optimization**: Smart forwarding reduces server and client bandwidth usage

### 🔧 **WebRTC Excellence**
- **Pion WebRTC**: Built on the industry-leading Go WebRTC library
- **ICE Handling**: Robust NAT traversal and connection establishment
- **STUN Support**: Configurable STUN servers for ICE discovery (TURN is intentionally not required)
- **Connection Recovery**: Automatic handling of network changes and reconnections
- **Rate Limiting**: Built-in protection against abuse and spam

### 🏗️ **Scalable Architecture**
- **Modular Design**: Clean separation of concerns for maintainability
- **Thread Safety**: Concurrent handling of multiple connections
- **Resource Efficient**: Minimal CPU and memory footprint
- **Production Ready**: Battle-tested architecture for high-load scenarios

## 🏗️ Architecture

This is a refactored version of the original monolithic SFU, now organized into multiple packages for better maintainability and extensibility.

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Signaling Server│◄──►│   SFU Server    │◄──►│   Web Client    │
│                 │    │                 │    │                 │
│ • User Mgmt     │    │ • Media Relay   │    │ • Audio Input   │
│ • Signaling     │    │ • Track Mgmt    │    │ • Audio Output  │
│ • Room Mgmt     │    │ • WebRTC Peers  │    │ • UI Feedback   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Project Structure

```
sfu-v2/
├── cmd/sfu/                    # Main application entry point
│   └── main.go
├── internal/                   # Private application packages
│   ├── config/                 # Configuration management
│   │   └── config.go
│   ├── websocket/              # WebSocket connection handling
│   │   ├── connection.go       # Thread-safe WebSocket wrapper
│   │   └── handler.go          # WebSocket message handling
│   ├── webrtc/                 # WebRTC peer connection management
│   │   └── peer.go
│   ├── track/                  # Media track lifecycle management
│   │   └── manager.go
│   └── signaling/              # WebRTC signaling coordination
│       └── coordinator.go
├── pkg/types/                  # Public shared types
│   └── messages.go             # WebSocket message structures
├── go.mod                      # Go module definition
├── env.example                 # Example environment variables
├── start.sh                    # Development start script
└── README.md
```

## 📦 Package Responsibilities

### `cmd/sfu`
- **Purpose**: Main application entry point
- **Responsibilities**: 
  - Coordinates all components
  - Sets up HTTP server and routing
  - Handles graceful shutdown

### `internal/config`
- **Purpose**: Configuration management
- **Responsibilities**:
  - Loads environment variables
  - Manages STUN configuration + ICE networking settings (pinned UDP port range, advertised IP)
  - Provides configuration to other packages

### `internal/websocket`
- **Purpose**: WebSocket communication layer
- **Responsibilities**:
  - Handles WebSocket upgrades and connections
  - Provides thread-safe WebSocket operations
  - Processes incoming WebSocket messages
  - Manages connection lifecycle

### `internal/webrtc`
- **Purpose**: WebRTC peer connection management
- **Responsibilities**:
  - Manages WebRTC peer connections
  - Handles ICE candidate exchange
  - Coordinates keyframe requests
  - Tracks connection states

### `internal/track`
- **Purpose**: Media track lifecycle management
- **Responsibilities**:
  - Manages media track lifecycle
  - Handles track addition/removal
  - Provides thread-safe track access
  - Coordinates track forwarding between peers

### `internal/signaling`
- **Purpose**: WebRTC signaling coordination
- **Responsibilities**:
  - Coordinates WebRTC signaling between peers
  - Manages offer/answer exchange
  - Synchronizes tracks across peer connections
  - Handles renegotiation logic

### `pkg/types`
- **Purpose**: Shared type definitions
- **Responsibilities**:
  - Defines shared message structures
  - Provides constants for WebSocket events
  - Can be imported by external packages

## 🚀 Getting Started

### Prerequisites
- **Go** 1.21+
- **Git** for version control
- **STUN servers** (recommended)

### Quick Start

1. **Navigate to SFU directory**
   ```bash
   cd webrtc/sfu-v2
   ```

2. **Copy environment configuration**
   ```bash
   cp env.example .env
   ```

3. **Edit configuration** (`.env`):
   ```env
   PORT=5005
   STUN_SERVERS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
   # Pin the UDP port range used for WebRTC media (open this range on the SFU host firewall)
   ICE_UDP_PORT_MIN=10000
   ICE_UDP_PORT_MAX=10004
   # Optional: force the IP address the SFU advertises in ICE host candidates
   # ICE_ADVERTISE_IP=203.0.113.10
   ```

4. **Start the SFU**
   ```bash
   # Using the start script (recommended)
   ./start.sh
   
   # Or manually
   go run ./cmd/sfu
   
   # Or build and run
   go build ./cmd/sfu
   ./sfu
   ```

### Development Setup

```bash
# Install dependencies
go mod download

# Run with live reload (requires air)
go install github.com/cosmtrek/air@latest
air

# Run tests
go test ./...

# Run with race detection
go run -race ./cmd/sfu
```

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5005` | HTTP server port |
| `STUN_SERVERS` | `stun:stun.l.google.com:19302` | Comma-separated STUN servers |
| `ICE_UDP_PORT_MIN` | - | Minimum UDP port for WebRTC media (pin a dedicated range) |
| `ICE_UDP_PORT_MAX` | - | Maximum UDP port for WebRTC media (pin a dedicated range) |
| `ICE_ADVERTISE_IP` | - | Force the IP address advertised in ICE host candidates |
| `DISABLE_STUN` | `false` | If true, do not use STUN (host candidates only) |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `MAX_CONNECTIONS` | `1000` | Maximum concurrent connections |

### Production Configuration

```env
# Production settings
PORT=5005
LOG_LEVEL=info
MAX_CONNECTIONS=5000

# STUN + ICE networking configuration
STUN_SERVERS=stun:your-stun1.com:3478,stun:your-stun2.com:3478
ICE_UDP_PORT_MIN=10000
ICE_UDP_PORT_MAX=10004
# ICE_ADVERTISE_IP=203.0.113.10

# Security
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=60s
```

## 🎯 API Reference

### WebSocket Events

#### Client → SFU

| Event | Payload | Description |
|-------|---------|-------------|
| `join` | `JoinMessage` | Join a room with user information |
| `leave` | `LeaveMessage` | Leave current room |
| `offer` | `RTCSessionDescription` | WebRTC offer from client |
| `answer` | `RTCSessionDescription` | WebRTC answer from client |
| `ice-candidate` | `RTCIceCandidate` | ICE candidate from client |

#### SFU → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `joined` | `JoinedMessage` | Confirmation of room join |
| `user-joined` | `UserJoinedMessage` | Another user joined the room |
| `user-left` | `UserLeftMessage` | User left the room |
| `offer` | `RTCSessionDescription` | WebRTC offer from SFU |
| `answer` | `RTCSessionDescription` | WebRTC answer from SFU |
| `ice-candidate` | `RTCIceCandidate` | ICE candidate from SFU |

### Message Types

```go
type JoinMessage struct {
    RoomID   string `json:"roomId"`
    UserID   string `json:"userId"`
    UserInfo struct {
        Nickname string `json:"nickname"`
        IsMuted  bool   `json:"isMuted"`
    } `json:"userInfo"`
}

type JoinedMessage struct {
    RoomID    string   `json:"roomId"`
    UserID    string   `json:"userId"`
    Peers     []string `json:"peers"`
    Success   bool     `json:"success"`
    Message   string   `json:"message,omitempty"`
}
```

## 🎛️ Media Processing

### Track Management

The SFU efficiently manages audio tracks:

```go
// Track lifecycle
1. Client joins room → Create peer connection
2. Client sends offer → Process and create answer
3. Client adds track → Forward to other peers
4. Client leaves → Clean up tracks and connections
```

### Forwarding Strategy

```go
// Selective forwarding algorithm
for each incoming track {
    for each peer in room {
        if peer != sender {
            forward track to peer
        }
    }
}
```

### Connection States

| State | Description | Actions |
|-------|-------------|---------|
| `new` | Initial connection state | Setup peer connection |
| `connecting` | ICE gathering/connecting | Exchange candidates |
| `connected` | Media flowing | Forward tracks |
| `disconnected` | Temporary disconnection | Attempt reconnection |
| `failed` | Connection failed | Clean up resources |
| `closed` | Connection closed | Remove from room |

## 🐛 Troubleshooting

### Common Issues

**SFU won't start?**
```bash
# Check port availability
netstat -tulpn | grep :5005

# Verify Go installation
go version

# Check environment variables
cat .env
```

**WebRTC connection fails?**
```bash
# Test STUN server connectivity
dig stun.l.google.com

# Check firewall rules
sudo ufw status

# Enable debug logging
LOG_LEVEL=debug go run ./cmd/sfu
```

**Audio not forwarding?**
```bash
# Check peer connections
curl http://localhost:5005/debug/peers

# Monitor track states
curl http://localhost:5005/debug/tracks

# Review connection logs
tail -f sfu.log
```

### Debug Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /debug/rooms` | Active rooms |
| `GET /debug/peers` | Peer connections |
| `GET /debug/tracks` | Media tracks |
| `GET /metrics` | Prometheus metrics |

## 🧪 Testing

### Unit Tests

```bash
# Run all tests
go test ./...

# Run with coverage
go test -cover ./...

# Run specific package
go test ./internal/track

# Benchmark tests
go test -bench=. ./...
```

### Integration Tests

```bash
# Run integration tests
go test -tags=integration ./...

# Load testing
go test -tags=load ./test/load
```

### Manual Testing

```bash
# Test WebSocket connection
wscat -c ws://localhost:5005

# Send join message
{"event": "join", "data": {"roomId": "test", "userId": "user1"}}
```

## 🚀 Production Deployment

### Docker Deployment

```dockerfile
# Multi-stage build
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o sfu ./cmd/sfu

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/sfu .
EXPOSE 5005
CMD ["./sfu"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gryt-sfu
spec:
  replicas: 3
  selector:
    matchLabels:
      app: gryt-sfu
  template:
    metadata:
      labels:
        app: gryt-sfu
    spec:
      containers:
      - name: sfu
        image: gryt/sfu:latest
        ports:
        - containerPort: 5005
        env:
        - name: PORT
          value: "5005"
        - name: STUN_SERVERS
          valueFrom:
            configMapKeyRef:
              name: sfu-config
              key: stun-servers
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 5005
          initialDelaySeconds: 30
          periodSeconds: 10
```

### Monitoring

```bash
# Prometheus metrics
curl http://localhost:5005/metrics

# Health check
curl http://localhost:5005/health

# Resource usage
docker stats gryt-sfu
```

## 🔮 Future Enhancements

The modular structure makes it easy to add new features:

### Adding Authentication
- Create `internal/auth/` package
- Modify `websocket.Handler.HandleWebSocket()` to validate tokens
- Update `cmd/sfu/main.go` to initialize auth components

### Adding Room Management
- Create `internal/room/` package for multi-room support
- Update signaling coordinator to be room-aware
- Modify track manager to isolate tracks by room

### Adding Recording
- Create `internal/recording/` package
- Hook into track manager to capture media streams
- Add recording controls via WebSocket messages

### Adding Metrics
- Create `internal/metrics/` package
- Add metrics collection throughout the application
- Expose metrics endpoint in main.go

## 🤝 Contributing

### Development Guidelines

1. **Follow Go best practices**
   ```go
   // Use proper error handling
   if err != nil {
       return fmt.Errorf("failed to process: %w", err)
   }
   
   // Use context for cancellation
   ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
   defer cancel()
   ```

2. **Write comprehensive tests**
   ```go
   func TestTrackManager_AddTrack(t *testing.T) {
       // Test implementation
   }
   ```

3. **Add proper logging**
   ```go
   log.Info("Processing track", 
       "trackID", track.ID(),
       "userID", userID,
       "roomID", roomID)
   ```

4. **Update documentation**
   - Add godoc comments
   - Update README for new features
   - Include usage examples

### Code Style
- Follow `gofmt` formatting
- Use meaningful variable names
- Implement proper error handling
- Add comprehensive logging
- Write testable code

## 📄 License

This project is licensed under the [MIT License](../../LICENSE).

---

**Part of the [Gryt Voice Chat Platform](../README.md)** 