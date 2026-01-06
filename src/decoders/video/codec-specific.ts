/**
 * Codec-specific parsing for VideoDecoder
 */

import { toUint8Array } from '../../utils/buffer.js';
import type { AvcConfig } from '../../utils/avc.js';
import { parseAvcDecoderConfig } from '../../utils/avc.js';
import type { HvccConfig } from '../../utils/hevc.js';
import { parseHvccDecoderConfig } from '../../utils/hevc.js';
import { getCodecBase } from '../../utils/codec-cache.js';
import type { VideoDecoderConfig } from './types.js';

/**
 * Parse AVC (H.264) description from decoder config
 */
export function parseAvcDescription(config: VideoDecoderConfig): AvcConfig | null {
  if (!config.description) {
    return null;
  }

  const codecBase = getCodecBase(config.codec);
  if (codecBase !== 'avc1' && codecBase !== 'avc3') {
    return null;
  }

  try {
    const bytes = toUint8Array(config.description);
    const copy = new Uint8Array(bytes);
    return parseAvcDecoderConfig(copy);
  } catch {
    return null;
  }
}

/**
 * Parse HEVC (H.265) description from decoder config
 */
export function parseHevcDescription(config: VideoDecoderConfig): HvccConfig | null {
  if (!config.description) {
    return null;
  }

  const codecBase = getCodecBase(config.codec);
  if (codecBase !== 'hvc1' && codecBase !== 'hev1') {
    return null;
  }

  try {
    const bytes = toUint8Array(config.description);
    const copy = new Uint8Array(bytes);
    return parseHvccDecoderConfig(copy);
  } catch {
    return null;
  }
}

/**
 * Get description buffer from config
 */
export function getDescriptionBuffer(config: VideoDecoderConfig | null): Uint8Array | null {
  if (!config?.description) {
    return null;
  }

  try {
    return toUint8Array(config.description);
  } catch {
    return null;
  }
}
