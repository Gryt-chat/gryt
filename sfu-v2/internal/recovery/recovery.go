package recovery

import (
	"encoding/json"
	"fmt"
	"log"
	"runtime"
	"runtime/debug"
	"sync"
	"time"
)

// ActionLogger tracks the last actions before crashes for debugging
type ActionLogger struct {
	actions []LogEntry
	mutex   sync.RWMutex
	maxSize int
}

// LogEntry represents a logged action with context
type LogEntry struct {
	Timestamp  time.Time `json:"timestamp"`
	Component  string    `json:"component"`
	Action     string    `json:"action"`
	ClientID   string    `json:"client_id,omitempty"`
	RoomID     string    `json:"room_id,omitempty"`
	Details    string    `json:"details,omitempty"`
	Goroutine  int       `json:"goroutine"`
	StackTrace string    `json:"stack_trace,omitempty"`
}

var (
	globalLogger *ActionLogger
	once         sync.Once
)

// GetLogger returns the global action logger instance
func GetLogger() *ActionLogger {
	once.Do(func() {
		globalLogger = &ActionLogger{
			actions: make([]LogEntry, 0, 1000),
			maxSize: 1000, // Keep last 1000 actions
		}
	})
	return globalLogger
}

// LogAction logs an action with context information
func (al *ActionLogger) LogAction(component, action, clientID, roomID, details string) {
	al.mutex.Lock()
	defer al.mutex.Unlock()

	entry := LogEntry{
		Timestamp: time.Now(),
		Component: component,
		Action:    action,
		ClientID:  clientID,
		RoomID:    roomID,
		Details:   details,
		Goroutine: getGoroutineID(),
	}

	// Add to actions slice
	al.actions = append(al.actions, entry)

	// Keep only the last maxSize entries
	if len(al.actions) > al.maxSize {
		al.actions = al.actions[len(al.actions)-al.maxSize:]
	}

	// Log to console in debug mode
	log.Printf("[ACTION-LOG] [%s] %s: %s (Client: %s, Room: %s) - %s",
		component, action, details, clientID, roomID, entry.Timestamp.Format("15:04:05.000"))
}

// GetRecentActions returns the most recent actions (for crash analysis)
func (al *ActionLogger) GetRecentActions(count int) []LogEntry {
	al.mutex.RLock()
	defer al.mutex.RUnlock()

	if count <= 0 || count > len(al.actions) {
		count = len(al.actions)
	}

	if count == 0 {
		return []LogEntry{}
	}

	start := len(al.actions) - count
	result := make([]LogEntry, count)
	copy(result, al.actions[start:])
	return result
}

// DumpRecentActions dumps recent actions to log (called on crash)
func (al *ActionLogger) DumpRecentActions() {
	recent := al.GetRecentActions(50) // Last 50 actions

	log.Printf("🚨 CRASH DETECTED - Dumping last %d actions:", len(recent))
	log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	for i, entry := range recent {
		log.Printf("[%d] %s | [%s] %s: %s",
			i+1,
			entry.Timestamp.Format("15:04:05.000"),
			entry.Component,
			entry.Action,
			entry.Details)

		if entry.ClientID != "" || entry.RoomID != "" {
			log.Printf("     Context: Client=%s, Room=%s, Goroutine=%d",
				entry.ClientID, entry.RoomID, entry.Goroutine)
		}
	}

	log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Also save to JSON file for detailed analysis
	if jsonData, err := json.MarshalIndent(recent, "", "  "); err == nil {
		log.Printf("💾 Recent actions JSON: %s", string(jsonData))
	}
}

// SafeExecute executes a function with panic recovery
func SafeExecute(component, action string, fn func() error) error {
	return SafeExecuteWithContext(component, action, "", "", "", fn)
}

// SafeExecuteWithContext executes a function with panic recovery and context
func SafeExecuteWithContext(component, action, clientID, roomID, details string, fn func() error) error {
	logger := GetLogger()

	// Log the action start
	logger.LogAction(component, action+"_START", clientID, roomID, details)

	defer func() {
		if r := recover(); r != nil {
			// Log the panic
			stack := string(debug.Stack())
			panicDetails := fmt.Sprintf("PANIC: %v", r)

			logger.LogAction(component, action+"_PANIC", clientID, roomID, panicDetails)

			// Dump recent actions for crash analysis
			logger.DumpRecentActions()

			// Log detailed panic information
			log.Printf("🚨 PANIC RECOVERED in %s.%s:", component, action)
			log.Printf("🚨 Panic: %v", r)
			log.Printf("🚨 Context: Client=%s, Room=%s, Details=%s", clientID, roomID, details)
			log.Printf("🚨 Stack trace:")
			log.Printf("%s", stack)
			log.Printf("🚨 Goroutine ID: %d", getGoroutineID())

			// Log system information
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			log.Printf("🚨 Memory: Alloc=%d KB, TotalAlloc=%d KB, Sys=%d KB, NumGC=%d",
				m.Alloc/1024, m.TotalAlloc/1024, m.Sys/1024, m.NumGC)
			log.Printf("🚨 Goroutines: %d", runtime.NumGoroutine())
		}
	}()

	// Execute the function
	err := fn()

	// Log completion
	if err != nil {
		logger.LogAction(component, action+"_ERROR", clientID, roomID, err.Error())
	} else {
		logger.LogAction(component, action+"_SUCCESS", clientID, roomID, details)
	}

	return err
}

// SafeGoroutine starts a goroutine with panic recovery
func SafeGoroutine(component, action string, fn func()) {
	SafeGoroutineWithContext(component, action, "", "", "", fn)
}

// SafeGoroutineWithContext starts a goroutine with panic recovery and context
func SafeGoroutineWithContext(component, action, clientID, roomID, details string, fn func()) {
	go func() {
		SafeExecuteWithContext(component, action, clientID, roomID, details, func() error {
			fn()
			return nil
		})
	}()
}

// SafeJSONMarshal safely marshals JSON with error handling
func SafeJSONMarshal(data interface{}) ([]byte, error) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("🚨 JSON Marshal panic recovered: %v", r)
			GetLogger().LogAction("JSON", "MARSHAL_PANIC", "", "", fmt.Sprintf("Data type: %T", data))
		}
	}()

	return json.Marshal(data)
}

// SafeJSONUnmarshal safely unmarshals JSON with error handling
func SafeJSONUnmarshal(data []byte, v interface{}) error {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("🚨 JSON Unmarshal panic recovered: %v", r)
			GetLogger().LogAction("JSON", "UNMARSHAL_PANIC", "", "", fmt.Sprintf("Data length: %d, Target type: %T", len(data), v))
		}
	}()

	return json.Unmarshal(data, v)
}

// getGoroutineID extracts the goroutine ID from the stack trace
func getGoroutineID() int {
	buf := make([]byte, 64)
	buf = buf[:runtime.Stack(buf, false)]

	// Parse "goroutine 123 [running]:"
	var id int
	if n, _ := fmt.Sscanf(string(buf), "goroutine %d ", &id); n == 1 {
		return id
	}
	return 0
}

// LogSystemStats logs current system statistics
func LogSystemStats() {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	log.Printf("📊 System Stats:")
	log.Printf("   Memory: Alloc=%d KB, TotalAlloc=%d KB, Sys=%d KB",
		m.Alloc/1024, m.TotalAlloc/1024, m.Sys/1024)
	log.Printf("   GC: NumGC=%d, PauseTotalNs=%d", m.NumGC, m.PauseTotalNs)
	log.Printf("   Goroutines: %d", runtime.NumGoroutine())
	log.Printf("   GOMAXPROCS: %d", runtime.GOMAXPROCS(0))
}

// StartSystemMonitor starts a background system monitor
func StartSystemMonitor(interval time.Duration) {
	SafeGoroutine("SYSTEM", "MONITOR", func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for range ticker.C {
			LogSystemStats()

			// Check for potential memory leaks
			var m runtime.MemStats
			runtime.ReadMemStats(&m)

			if m.Alloc > 500*1024*1024 { // 500MB threshold
				log.Printf("⚠️ High memory usage detected: %d MB", m.Alloc/1024/1024)
				GetLogger().LogAction("SYSTEM", "HIGH_MEMORY", "", "", fmt.Sprintf("Memory: %d MB", m.Alloc/1024/1024))
			}

			if runtime.NumGoroutine() > 1000 { // 1000 goroutines threshold
				log.Printf("⚠️ High goroutine count detected: %d", runtime.NumGoroutine())
				GetLogger().LogAction("SYSTEM", "HIGH_GOROUTINES", "", "", fmt.Sprintf("Count: %d", runtime.NumGoroutine()))
			}
		}
	})
}
