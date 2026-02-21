# SFU Crash Prevention & Recovery System

## Overview

The SFU server now includes a comprehensive crash prevention and recovery system designed to prevent server crashes and provide detailed logging for debugging. This system wraps all critical operations with panic recovery and provides extensive action logging.

## Features

### 🛡️ Panic Recovery
- **Global panic recovery** in main() function
- **Component-level recovery** for all major operations
- **Goroutine-safe recovery** for background tasks
- **Graceful degradation** instead of crashes

### 📊 Action Logging
- **Comprehensive action tracking** with timestamps
- **Context-aware logging** (client ID, room ID, component)
- **Crash analysis** with last 50 actions before crash
- **System monitoring** with memory and goroutine tracking

### 🔧 Safe Operations
- **Safe JSON marshaling/unmarshaling** with panic protection
- **Protected WebSocket operations** with error handling
- **Safe WebRTC operations** with state validation
- **Concurrent map access protection** with proper locking

## Components Protected

### 1. Main Server (`cmd/sfu/main.go`)
- ✅ Global panic recovery
- ✅ Component initialization protection
- ✅ HTTP server crash protection
- ✅ Background task safety

### 2. WebSocket Handler (`internal/websocket/handler.go`)
- ✅ Connection upgrade protection
- ✅ Message processing safety
- ✅ WebRTC event handler protection
- ✅ RTP packet forwarding safety

### 3. Signaling Coordinator (`internal/signaling/coordinator.go`)
- ✅ Peer connection signaling protection
- ✅ Track management safety
- ✅ Offer/answer processing protection
- ✅ ICE candidate handling safety

### 4. Room Manager (`internal/room/manager.go`)
- ✅ Room creation/deletion protection
- ✅ Peer addition/removal safety
- ✅ Concurrent access protection
- ✅ Cleanup operation safety

## Usage Examples

### Basic Safe Execution
```go
err := recovery.SafeExecute("COMPONENT", "ACTION", func() error {
    // Your potentially dangerous code here
    return someRiskyOperation()
})
```

### Safe Execution with Context
```go
err := recovery.SafeExecuteWithContext("WEBSOCKET", "HANDLE_MESSAGE", clientID, roomID, "Processing client message", func() error {
    // Your code with full context logging
    return processMessage(message)
})
```

### Safe Goroutine
```go
recovery.SafeGoroutineWithContext("BACKGROUND", "CLEANUP", "", roomID, "Room cleanup task", func() {
    // Background task that won't crash the server
    performCleanup()
})
```

### Safe JSON Operations
```go
// Safe marshaling
data, err := recovery.SafeJSONMarshal(object)

// Safe unmarshaling
err := recovery.SafeJSONUnmarshal(data, &target)
```

## Logging System

### Action Logging
Every operation is logged with:
- **Timestamp**: Precise timing information
- **Component**: Which part of the system (WEBSOCKET, SIGNALING, etc.)
- **Action**: What operation was being performed
- **Context**: Client ID, Room ID, additional details
- **Goroutine ID**: For concurrent operation tracking

### Crash Analysis
When a panic occurs:
1. **Immediate recovery** prevents server crash
2. **Action dump** shows last 50 operations
3. **System stats** show memory/goroutine state
4. **Stack trace** provides detailed error location
5. **JSON export** for detailed analysis

### System Monitoring
Automatic monitoring includes:
- **Memory usage** tracking (alerts at 500MB+)
- **Goroutine count** monitoring (alerts at 1000+)
- **System statistics** every 30 seconds
- **Performance metrics** logging

## Configuration

### Debug Mode
Enable detailed logging by setting `debug: true` in configuration:
```go
cfg.Debug = true  // Enables verbose action logging
```

### Monitoring Interval
System monitoring runs every 30 seconds by default:
```go
recovery.StartSystemMonitor(30 * time.Second)
```

## Error Handling Strategy

### 1. Graceful Degradation
Instead of crashing, the system:
- Logs the error with full context
- Continues operation where possible
- Isolates failures to prevent cascade effects
- Provides meaningful error messages

### 2. State Validation
All operations include:
- **Nil pointer checks** before dereferencing
- **Connection state validation** before WebRTC operations
- **Map existence checks** before access
- **Resource availability verification**

### 3. Concurrent Safety
Protected operations include:
- **Mutex-protected map access** with proper locking
- **Safe goroutine spawning** with panic recovery
- **Resource cleanup** with timeout protection
- **State synchronization** across components

## Monitoring & Alerts

### Memory Monitoring
```
⚠️ High memory usage detected: 512 MB
```

### Goroutine Monitoring
```
⚠️ High goroutine count detected: 1024
```

### Crash Detection
```
🚨 CRASH DETECTED - Dumping last 50 actions:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1] 15:04:05.123 | [WEBSOCKET] HANDLE_CONNECTION: New client connection
[2] 15:04:05.124 | [SIGNALING] SIGNAL_PEERS: Starting peer signaling
...
```

## Best Practices

### 1. Always Use Recovery Wrappers
```go
// ❌ Dangerous
func riskyOperation() {
    // Direct operation that could panic
}

// ✅ Safe
func safeOperation() {
    recovery.SafeExecute("COMPONENT", "OPERATION", func() error {
        // Protected operation
        return nil
    })
}
```

### 2. Provide Context Information
```go
// ❌ Minimal context
recovery.SafeExecute("WEBSOCKET", "PROCESS", func() error {
    return processMessage()
})

// ✅ Rich context
recovery.SafeExecuteWithContext("WEBSOCKET", "PROCESS_MESSAGE", clientID, roomID, "Processing client join", func() error {
    return processMessage()
})
```

### 3. Validate Inputs
```go
// ✅ Always validate before use
if peerConnection == nil {
    return fmt.Errorf("peer connection is nil")
}
if peerConnection.ConnectionState() == webrtc.PeerConnectionStateClosed {
    return fmt.Errorf("peer connection is closed")
}
```

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Check for goroutine leaks
   - Verify proper resource cleanup
   - Monitor room cleanup frequency

2. **High Goroutine Count**
   - Check for infinite loops in background tasks
   - Verify proper goroutine termination
   - Monitor WebSocket connection cleanup

3. **Frequent Panics**
   - Review action logs before crashes
   - Check for nil pointer dereferences
   - Validate WebRTC state transitions

### Log Analysis

Use the action logs to:
1. **Identify patterns** in crashes
2. **Track operation sequences** leading to failures
3. **Monitor system performance** over time
4. **Debug race conditions** with goroutine IDs

## Performance Impact

The recovery system is designed to be lightweight:
- **Minimal overhead** for normal operations
- **Efficient logging** with circular buffer
- **Lazy evaluation** for debug information
- **Background monitoring** with configurable intervals

## Future Enhancements

Planned improvements:
- **Metrics export** to monitoring systems
- **Automatic recovery strategies** for common failures
- **Performance profiling** integration
- **Distributed tracing** support

## Conclusion

This crash prevention system transforms the SFU from a crash-prone service into a robust, self-healing system that provides excellent observability and debugging capabilities. The comprehensive logging ensures that any issues can be quickly identified and resolved, while the recovery mechanisms keep the service running even under adverse conditions. 