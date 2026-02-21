#!/usr/bin/env node

/**
 * Audio Analysis Tool for Voice Chat Testing
 * 
 * This tool can analyze recorded audio to detect if voice transmission is working.
 * It can be used to verify that audio is being transmitted between clients.
 */

const fs = require('fs');
const path = require('path');

class AudioAnalyzer {
  constructor() {
    this.sampleRate = 44100;
    this.threshold = 0.01; // Minimum audio level to consider as "sound detected"
  }

  /**
   * Analyze audio data array (normalized 0-1 values)
   */
  analyzeAudioData(audioData) {
    if (!audioData || audioData.length === 0) {
      return {
        success: false,
        error: 'No audio data provided'
      };
    }

    const maxLevel = Math.max(...audioData);
    const minLevel = Math.min(...audioData);
    const averageLevel = audioData.reduce((sum, level) => sum + level, 0) / audioData.length;
    
    // Calculate RMS (Root Mean Square) for better audio level detection
    const rms = Math.sqrt(audioData.reduce((sum, level) => sum + level * level, 0) / audioData.length);
    
    // Detect audio peaks (sustained audio above threshold)
    const peaks = this.detectPeaks(audioData);
    
    // Calculate audio activity percentage
    const activeSamples = audioData.filter(level => level > this.threshold).length;
    const activityPercentage = (activeSamples / audioData.length) * 100;

    return {
      success: true,
      maxLevel,
      minLevel,
      averageLevel,
      rms,
      peaks,
      activityPercentage,
      audioDetected: maxLevel > this.threshold,
      dataPoints: audioData.length,
      duration: audioData.length * 0.1 // Assuming 100ms intervals
    };
  }

  /**
   * Detect audio peaks (sustained audio above threshold)
   */
  detectPeaks(audioData) {
    const peaks = [];
    let currentPeak = null;
    
    for (let i = 0; i < audioData.length; i++) {
      const level = audioData[i];
      
      if (level > this.threshold) {
        if (!currentPeak) {
          currentPeak = {
            start: i,
            maxLevel: level,
            duration: 1
          };
        } else {
          currentPeak.duration++;
          currentPeak.maxLevel = Math.max(currentPeak.maxLevel, level);
        }
      } else {
        if (currentPeak && currentPeak.duration >= 3) { // Minimum 300ms peak
          peaks.push({
            ...currentPeak,
            startTime: currentPeak.start * 0.1, // Convert to seconds
            duration: currentPeak.duration * 0.1
          });
        }
        currentPeak = null;
      }
    }
    
    // Handle peak that extends to end of data
    if (currentPeak && currentPeak.duration >= 3) {
      peaks.push({
        ...currentPeak,
        startTime: currentPeak.start * 0.1,
        duration: currentPeak.duration * 0.1
      });
    }
    
    return peaks;
  }

  /**
   * Generate a test report
   */
  generateReport(analysis) {
    if (!analysis.success) {
      return `❌ Audio Analysis Failed: ${analysis.error}`;
    }

    const report = [
      '🎵 Audio Analysis Report',
      '='.repeat(50),
      `📊 Data Points: ${analysis.dataPoints}`,
      `⏱️  Duration: ${analysis.duration.toFixed(1)}s`,
      `📈 Max Level: ${analysis.maxLevel.toFixed(4)}`,
      `📉 Min Level: ${analysis.minLevel.toFixed(4)}`,
      `📊 Average Level: ${analysis.averageLevel.toFixed(4)}`,
      `🔊 RMS Level: ${analysis.rms.toFixed(4)}`,
      `🎯 Activity: ${analysis.activityPercentage.toFixed(1)}%`,
      `🔍 Audio Detected: ${analysis.audioDetected ? '✅ YES' : '❌ NO'}`,
      `🎵 Peaks Found: ${analysis.peaks.length}`,
      ''
    ];

    if (analysis.peaks.length > 0) {
      report.push('🎵 Audio Peaks:');
      analysis.peaks.forEach((peak, index) => {
        report.push(`   Peak ${index + 1}: ${peak.startTime.toFixed(1)}s - ${(peak.startTime + peak.duration).toFixed(1)}s (${peak.maxLevel.toFixed(4)})`);
      });
    }

    // Add interpretation
    report.push('');
    report.push('🔍 Interpretation:');
    if (analysis.audioDetected) {
      report.push('   ✅ Audio transmission appears to be working');
      report.push(`   📊 Audio activity: ${analysis.activityPercentage.toFixed(1)}% of the time`);
      if (analysis.peaks.length > 0) {
        report.push(`   🎵 Detected ${analysis.peaks.length} audio peaks`);
      }
    } else {
      report.push('   ❌ No significant audio detected');
      report.push('   🔧 Possible issues:');
      report.push('      - Microphone not working');
      report.push('      - Audio not being transmitted');
      report.push('      - WebRTC connection failed');
      report.push('      - SFU not forwarding audio');
    }

    return report.join('\n');
  }

  /**
   * Save analysis results to file
   */
  saveResults(analysis, filename) {
    const report = this.generateReport(analysis);
    const jsonData = JSON.stringify(analysis, null, 2);
    
    // Save text report
    fs.writeFileSync(filename + '.txt', report);
    
    // Save JSON data
    fs.writeFileSync(filename + '.json', jsonData);
    
    console.log(`📁 Results saved to ${filename}.txt and ${filename}.json`);
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
🎵 Audio Analyzer for Voice Chat Testing

Usage:
  node audio-analyzer.js <audio-data-file>

Example:
  node audio-analyzer.js test-audio.json

The audio data file should contain an array of normalized audio levels (0-1).
    `);
    process.exit(1);
  }

  const filename = args[0];
  
  if (!fs.existsSync(filename)) {
    console.error(`❌ File not found: ${filename}`);
    process.exit(1);
  }

  try {
    const audioData = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const analyzer = new AudioAnalyzer();
    const analysis = analyzer.analyzeAudioData(audioData);
    
    console.log(analyzer.generateReport(analysis));
    
    // Save results
    const outputFilename = filename.replace('.json', '') + '-analysis';
    analyzer.saveResults(analysis, outputFilename);
    
  } catch (error) {
    console.error(`❌ Error analyzing audio: ${error.message}`);
    process.exit(1);
  }
}

module.exports = AudioAnalyzer;
