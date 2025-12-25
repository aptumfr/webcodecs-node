/**
 * Hardware encoder selection
 *
 * Functions for selecting the best encoder based on hardware capabilities.
 */

import { spawn } from 'child_process';
import type {
  HardwareAccelerationMethod,
  HardwareCapabilities,
  HardwareEncoderInfo,
  VideoCodecName,
} from './types.js';
import { SOFTWARE_ENCODERS } from './types.js';
import {
  detectHardwareAcceleration,
  detectHardwareAccelerationSync,
} from './detection.js';
import { getHwaccelConfig } from '../config/webcodecs-config.js';

/**
 * Get the best available encoder for a codec
 */
export async function getBestEncoder(
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference' = 'no-preference'
): Promise<{ encoder: string; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean }> {
  const capabilities = await detectHardwareAcceleration();
  return selectBestEncoder(capabilities, codec, preference);
}

export function getBestEncoderSync(
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference' = 'no-preference'
): { encoder: string; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean } {
  const capabilities = detectHardwareAccelerationSync();
  return selectBestEncoder(capabilities, codec, preference);
}

/**
 * Sort encoders by config priority order, then by default priority
 */
function sortEncodersByConfig(
  encoders: (HardwareEncoderInfo & { available: boolean })[],
  configOrder: HardwareAccelerationMethod[] | undefined
): (HardwareEncoderInfo & { available: boolean })[] {
  if (!configOrder || configOrder.length === 0) {
    // No config override - use default priorities
    return encoders.sort((a, b) => a.priority - b.priority);
  }

  // Sort by config order first, then by default priority for methods not in config
  return encoders.sort((a, b) => {
    const aIdx = configOrder.indexOf(a.hwaccel);
    const bIdx = configOrder.indexOf(b.hwaccel);

    // Both in config - use config order
    if (aIdx !== -1 && bIdx !== -1) {
      return aIdx - bIdx;
    }
    // Only a in config - a wins
    if (aIdx !== -1) return -1;
    // Only b in config - b wins
    if (bIdx !== -1) return 1;
    // Neither in config - use default priority
    return a.priority - b.priority;
  });
}

function selectBestEncoder(
  capabilities: HardwareCapabilities,
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference'
): { encoder: string; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean } {
  if (preference === 'prefer-software') {
    return {
      encoder: SOFTWARE_ENCODERS[codec],
      hwaccel: null,
      isHardware: false,
    };
  }

  // Get config-based hwaccel order for this codec
  const configOrder = getHwaccelConfig(codec);

  // If config explicitly sets empty array, force software encoding
  if (configOrder !== undefined && configOrder.length === 0) {
    return {
      encoder: SOFTWARE_ENCODERS[codec],
      hwaccel: null,
      isHardware: false,
    };
  }

  // Find available hardware encoders for this codec
  const hwEncoders = capabilities.encoders
    .filter(enc => enc.codec === codec && enc.available);

  // Sort by config order, then default priority
  const sorted = sortEncodersByConfig(hwEncoders, configOrder);

  if (sorted.length > 0) {
    const best = sorted[0];
    return {
      encoder: best.name,
      hwaccel: best.hwaccel,
      isHardware: true,
    };
  }

  // Fall back to software
  return {
    encoder: SOFTWARE_ENCODERS[codec],
    hwaccel: null,
    isHardware: false,
  };
}

/**
 * Test if a specific hardware encoder actually works
 * (Some systems report encoders as available but they may not function)
 */
export async function testEncoder(encoderName: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Use 320x240 to meet minimum hardware encoder constraints
    // (e.g., AMD VAAPI requires at least 256x128)
    const testArgs = [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=320x240:d=0.1',
      '-c:v', encoderName,
      '-frames:v', '1',
      '-f', 'null',
      '-',
    ];

    // Add VAAPI device if needed
    if (encoderName.includes('vaapi')) {
      testArgs.splice(0, 0, '-vaapi_device', '/dev/dri/renderD128');
      // Insert filter before output options
      const outputIdx = testArgs.indexOf('-c:v');
      testArgs.splice(outputIdx, 0, '-vf', 'format=nv12,hwupload');
    }

    const proc = spawn('ffmpeg', testArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Note: We only check exit code, not stderr, because FFmpeg outputs
    // warnings (like "packed headers" for VAAPI) to stderr even on success
    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Map WebCodecs codec string to VideoCodecName
 */
export function parseCodecString(webCodecsCodec: string): VideoCodecName | null {
  const codecBase = webCodecsCodec.split('.')[0].toLowerCase();

  const codecMap: Record<string, VideoCodecName> = {
    'avc1': 'h264',
    'avc3': 'h264',
    'hev1': 'hevc',
    'hvc1': 'hevc',
    'vp8': 'vp8',
    'vp09': 'vp9',
    'vp9': 'vp9',
    'av01': 'av1',
    'av1': 'av1',
  };

  return codecMap[codecBase] || null;
}
