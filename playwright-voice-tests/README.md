# 🎙️ Voice Chat Playwright Tests

This directory contains automated tests for your voice chat system using Playwright. These tests can help you debug voice transmission issues and verify that your WebRTC setup is working correctly.

## 🚀 Quick Start

1. **Install dependencies**:
   ```bash
   cd playwright-voice-tests
   npm install
   npx playwright install
   ```

2. **Start your servers** (in separate terminals):
   ```bash
   # Terminal 1: Start WebSocket server
   cd ../server
   npm run dev

   # Terminal 2: Start SFU server
   cd ../sfu-v2
   go run main.go

   # Terminal 3: Start client (will be started automatically by Playwright)
   cd ../client
   npm run dev
   ```

3. **Run the tests**:
   ```bash
   # Run all tests
   npm test

   # Run only voice transmission tests
   npm run test:voice

   # Run tests with browser UI (for debugging)
   npm run test:headed

   # Run tests in debug mode
   npm run test:debug
   ```

## 🧪 Test Types

### 1. **Voice Transmission Test** (`voice-transmission.spec.ts`)
- Creates two browser instances (sender and receiver)
- Establishes voice connection between them
- Generates test audio on sender
- Records and analyzes audio on receiver
- Verifies that voice transmission is working

### 2. **WebRTC Debug Test** (`webrtc-debug.spec.ts`)
- Tests WebRTC support and configuration
- Verifies microphone access
- Tests STUN server connectivity
- Checks SFU WebSocket connection
- Tests voice channel click handlers
- Tests server connection and room access

## 🔍 What the Tests Check

### ✅ **Infrastructure Tests**
- WebRTC browser support
- Microphone permissions and access
- STUN server connectivity
- SFU server connection
- Server WebSocket connection

### ✅ **Voice Transmission Tests**
- Voice channel connection establishment
- Audio generation and transmission
- Audio reception and analysis
- Connection state verification

### ✅ **Error Detection**
- Console error monitoring
- Connection failure detection
- Audio transmission failure detection

## 📊 Understanding Test Results

### **Voice Transmission Test Results**
```
🎵 Audio Analysis Report
==================================================
📊 Data Points: 40
⏱️  Duration: 4.0s
📈 Max Level: 0.1234
📉 Min Level: 0.0001
📊 Average Level: 0.0234
🔊 RMS Level: 0.0456
🎯 Activity: 15.2%
🔍 Audio Detected: ✅ YES
🎵 Peaks Found: 2

🎵 Audio Peaks:
   Peak 1: 1.2s - 2.1s (0.1234)
   Peak 2: 3.1s - 3.8s (0.0987)

🔍 Interpretation:
   ✅ Audio transmission appears to be working
   📊 Audio activity: 15.2% of the time
   🎵 Detected 2 audio peaks
```

### **WebRTC Debug Test Results**
```
🔍 WebRTC Support Check:
   RTCPeerConnection: true
   getUserMedia: true
   WebRTC Supported: true

🎤 Microphone Access Test:
   ✅ Success: 1 audio tracks
   Track 1: Default - Audio Input (live)

🌐 STUN Server Test:
   ✅ Success: 4 ICE candidates gathered
   Candidate 1: host UDP 192.168.1.100
   Candidate 2: srflx UDP 203.0.113.1
   Candidate 3: relay UDP 203.0.113.2
   Candidate 4: host TCP 192.168.1.100
```

## 🐛 Debugging Failed Tests

### **No Audio Detected**
If the voice transmission test shows "❌ No significant audio detected":

1. **Check microphone permissions**:
   ```bash
   npm run test:headed
   # Look for microphone permission prompts
   ```

2. **Check console errors**:
   ```bash
   npm run test:debug
   # Look for WebRTC or SFU connection errors
   ```

3. **Verify server configuration**:
   - Check if voice channels are configured
   - Verify SFU server is running
   - Check STUN server configuration

### **WebRTC Connection Failed**
If WebRTC tests fail:

1. **Check browser compatibility**:
   - Ensure you're using Chrome/Chromium
   - Check if WebRTC is enabled

2. **Check network configuration**:
   - Verify STUN servers are accessible
   - Check firewall settings
   - Test with different STUN servers

### **SFU Connection Failed**
If SFU tests fail:

1. **Check SFU server**:
   ```bash
   curl -I http://localhost:5005/health
   ```

2. **Check SFU configuration**:
   - Verify SFU_WS_HOST in .env
   - Check SFU server logs

## 🔧 Customizing Tests

### **Modify Test Configuration**
Edit `playwright.config.ts`:
```typescript
use: {
  baseURL: 'http://localhost:3666', // Your client URL
  // Add custom browser args
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream']
  }
}
```

### **Add Custom Audio Tests**
Create new test files in the `tests/` directory:
```typescript
import { test, expect } from '@playwright/test';

test('my custom voice test', async ({ page }) => {
  // Your test code here
});
```

### **Modify Audio Analysis**
Edit `audio-analyzer.js` to change:
- Audio detection threshold
- Peak detection parameters
- Analysis algorithms

## 📁 File Structure

```
playwright-voice-tests/
├── package.json              # Dependencies and scripts
├── playwright.config.ts      # Playwright configuration
├── audio-analyzer.js         # Audio analysis tool
├── README.md                 # This file
└── tests/
    ├── voice-transmission.spec.ts  # Main voice transmission test
    └── webrtc-debug.spec.ts        # WebRTC debugging tests
```

## 🚨 Troubleshooting

### **Tests Won't Start**
- Ensure all servers are running
- Check port conflicts (3666, 5001, 5005)
- Verify Playwright installation

### **Audio Tests Fail**
- Check microphone permissions
- Verify audio device selection
- Test with different browsers

### **Connection Tests Fail**
- Check server logs for errors
- Verify network connectivity
- Test with different STUN servers

## 📈 Continuous Integration

To run these tests in CI/CD:

```yaml
# .github/workflows/voice-tests.yml
name: Voice Chat Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - uses: actions/setup-go@v3
      - run: cd playwright-voice-tests && npm install
      - run: npx playwright install
      - run: npm test
```

## 🎯 Next Steps

1. **Run the tests** to identify the current issue
2. **Check the test results** to see what's failing
3. **Use the debugging information** to fix the problems
4. **Re-run tests** to verify fixes
5. **Set up CI/CD** to prevent regressions

The tests will give you concrete data about what's working and what's not, making it much easier to debug voice transmission issues!
