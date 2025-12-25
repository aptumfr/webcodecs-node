/**
 * Hardware decoder selection
 *
 * Functions for selecting the best decoder based on hardware capabilities.
 */

import type {
  HardwareAccelerationMethod,
  HardwareCapabilities,
  HardwareDecoderInfo,
  VideoCodecName,
} from './types.js';
import {
  detectHardwareAcceleration,
  detectHardwareAccelerationSync,
} from './detection.js';
import { getHwaccelConfig } from '../config/webcodecs-config.js';

/**
 * Get the best available decoder for a codec
 */
export async function getBestDecoder(
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference' = 'no-preference'
): Promise<{ decoder: string | null; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean }> {
  const capabilities = await detectHardwareAcceleration();
  return selectBestDecoder(capabilities, codec, preference);
}

export function getBestDecoderSync(
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference' = 'no-preference'
): { decoder: string | null; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean } {
  const capabilities = detectHardwareAccelerationSync();
  return selectBestDecoder(capabilities, codec, preference);
}

/**
 * Sort decoders by config priority order, then by default priority
 */
function sortDecodersByConfig(
  decoders: (HardwareDecoderInfo & { available: boolean })[],
  configOrder: HardwareAccelerationMethod[] | undefined
): (HardwareDecoderInfo & { available: boolean })[] {
  if (!configOrder || configOrder.length === 0) {
    // No config override - use default priorities
    return decoders.sort((a, b) => a.priority - b.priority);
  }

  // Sort by config order first, then by default priority for methods not in config
  return decoders.sort((a, b) => {
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

function selectBestDecoder(
  capabilities: HardwareCapabilities,
  codec: VideoCodecName,
  preference: 'prefer-hardware' | 'prefer-software' | 'no-preference'
): { decoder: string | null; hwaccel: HardwareAccelerationMethod | null; isHardware: boolean } {
  if (preference === 'prefer-software') {
    return {
      decoder: null, // Use default FFmpeg decoder
      hwaccel: null,
      isHardware: false,
    };
  }

  // Get config-based hwaccel order for this codec
  const configOrder = getHwaccelConfig(codec);

  // Find available hardware decoders for this codec
  const hwDecoders = capabilities.decoders
    .filter(dec => dec.codec === codec && dec.available);

  // Sort by config order, then default priority
  const sorted = sortDecodersByConfig(hwDecoders, configOrder);

  if (sorted.length > 0) {
    const best = sorted[0];
    return {
      decoder: best.name,
      hwaccel: best.hwaccel,
      isHardware: true,
    };
  }

  // Fall back to software
  return {
    decoder: null,
    hwaccel: null,
    isHardware: false,
  };
}

