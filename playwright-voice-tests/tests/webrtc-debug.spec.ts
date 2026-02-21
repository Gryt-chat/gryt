import { test, expect, Page } from '@playwright/test';

test.describe('WebRTC Debug Tests', () => {
  test('should detect WebRTC support and configuration', async ({ page }) => {
    await page.goto('/');
    
    // Check WebRTC support
    const webrtcSupport = await page.evaluate(() => {
      return {
        rtcPeerConnection: !!window.RTCPeerConnection,
        getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        webRTCSupported: !!(window.RTCPeerConnection && navigator.mediaDevices)
      };
    });

    console.log('🔍 WebRTC Support Check:');
    console.log(`   RTCPeerConnection: ${webrtcSupport.rtcPeerConnection}`);
    console.log(`   getUserMedia: ${webrtcSupport.getUserMedia}`);
    console.log(`   WebRTC Supported: ${webrtcSupport.webRTCSupported}`);

    expect(webrtcSupport.webRTCSupported).toBe(true);
  });

  test('should test microphone access', async ({ page }) => {
    await page.goto('/');
    
    // Test microphone access
    const micAccess = await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioTracks = stream.getAudioTracks();
        
        return {
          success: true,
          trackCount: audioTracks.length,
          trackStates: audioTracks.map(track => ({
            id: track.id,
            label: track.label,
            enabled: track.enabled,
            readyState: track.readyState
          }))
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    });

    console.log('🎤 Microphone Access Test:');
    if (micAccess.success) {
      console.log(`   ✅ Success: ${micAccess.trackCount} audio tracks`);
      micAccess.trackStates.forEach((track, index) => {
        console.log(`   Track ${index + 1}: ${track.label} (${track.readyState})`);
      });
    } else {
      console.log(`   ❌ Failed: ${micAccess.error}`);
    }

    expect(micAccess.success).toBe(true);
  });

  test('should test STUN server connectivity', async ({ page }) => {
    await page.goto('/');
    
    const stunTest = await page.evaluate(async () => {
      try {
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        });

        return new Promise((resolve) => {
          const candidates: any[] = [];
          let resolved = false;

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              candidates.push({
                type: event.candidate.type,
                protocol: event.candidate.protocol,
                address: event.candidate.address
              });
            } else {
              // ICE gathering complete
              if (!resolved) {
                resolved = true;
                pc.close();
                resolve({
                  success: true,
                  candidateCount: candidates.length,
                  candidates: candidates.slice(0, 5) // First 5 candidates
                });
              }
            }
          };

          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete' && !resolved) {
              resolved = true;
              pc.close();
              resolve({
                success: true,
                candidateCount: candidates.length,
                candidates: candidates.slice(0, 5)
              });
            }
          };

          // Start ICE gathering
          pc.createDataChannel('test');
          pc.createOffer().then(offer => pc.setLocalDescription(offer));

          // Timeout after 10 seconds
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              pc.close();
              resolve({
                success: false,
                error: 'STUN test timeout',
                candidateCount: candidates.length
              });
            }
          }, 10000);
        });
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    });

    console.log('🌐 STUN Server Test:');
    if (stunTest.success) {
      console.log(`   ✅ Success: ${stunTest.candidateCount} ICE candidates gathered`);
      stunTest.candidates.forEach((candidate, index) => {
        console.log(`   Candidate ${index + 1}: ${candidate.type} ${candidate.protocol} ${candidate.address}`);
      });
    } else {
      console.log(`   ❌ Failed: ${stunTest.error}`);
    }

    expect(stunTest.success).toBe(true);
  });

  test('should test SFU WebSocket connection', async ({ page }) => {
    await page.goto('/');
    
    // Wait for app to load
    await page.waitForLoadState('networkidle');
    
    // Check if SFU connection is established
    const sfuConnection = await page.evaluate(() => {
      // Look for SFU connection indicators in the app
      const sfuConnected = !!(window as any).sfuConnection;
      const sfuWebSocket = !!(window as any).sfuWebSocketRef?.current;
      
      return {
        sfuConnected,
        sfuWebSocket,
        connectionState: (window as any).connectionState
      };
    });

    console.log('🔌 SFU Connection Test:');
    console.log(`   SFU Connected: ${sfuConnection.sfuConnected}`);
    console.log(`   SFU WebSocket: ${sfuConnection.sfuWebSocket}`);
    console.log(`   Connection State: ${JSON.stringify(sfuConnection.connectionState)}`);

    // This test might fail if no voice channel is connected, which is expected
    // We're just checking if the infrastructure is in place
  });

  test('should test voice channel click handler', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Listen for console messages
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      if (msg.text().includes('VOICE CHANNEL CLICK') || 
          msg.text().includes('requestRoomAccess') ||
          msg.text().includes('room_access_granted')) {
        consoleMessages.push(msg.text());
      }
    });

    // Look for voice channels and click them
    const voiceChannels = page.locator('[data-channel-type="voice"], .voice-channel, [class*="voice"]');
    const channelCount = await voiceChannels.count();
    
    console.log(`🎤 Found ${channelCount} voice channels`);
    
    if (channelCount > 0) {
      await voiceChannels.first().click();
      await page.waitForTimeout(3000); // Wait for connection attempt
      
      console.log('📝 Console messages after voice channel click:');
      consoleMessages.forEach(msg => console.log(`   ${msg}`));
    } else {
      console.log('⚠️ No voice channels found - this might be the issue!');
    }
  });

  test('should test server connection and room access', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Join server first
    const serverInput = page.locator('input[placeholder*="server"], input[placeholder*="host"]').first();
    const joinButton = page.locator('button:has-text("Join"), button:has-text("Connect")').first();
    
    if (await serverInput.isVisible()) {
      await serverInput.fill('localhost:5001');
      await joinButton.click();
      await page.waitForTimeout(2000);
    }
    
    // Test room access request
    const roomAccessTest = await page.evaluate(() => {
      return new Promise((resolve) => {
        const socket = (window as any).sockets?.['localhost:5001'] || 
                      Object.values((window as any).sockets || {})[0];
        
        if (!socket) {
          resolve({ success: false, error: 'No socket connection found' });
          return;
        }
        
        let resolved = false;
        
        socket.on('room_access_granted', (data: any) => {
          if (!resolved) {
            resolved = true;
            resolve({ success: true, data });
          }
        });
        
        socket.on('room_error', (error: any) => {
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error });
          }
        });
        
        // Request room access
        socket.emit('requestRoomAccess', 'test-room');
        
        // Timeout after 5 seconds
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve({ success: false, error: 'Room access request timeout' });
          }
        }, 5000);
      });
    });

    console.log('🏠 Room Access Test:');
    if (roomAccessTest.success) {
      console.log(`   ✅ Success: Room access granted`);
      console.log(`   Room ID: ${roomAccessTest.data.room_id}`);
      console.log(`   SFU URL: ${roomAccessTest.data.sfu_url}`);
    } else {
      console.log(`   ❌ Failed: ${roomAccessTest.error}`);
    }
  });
});
