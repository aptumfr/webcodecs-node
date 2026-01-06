/**
 * AAC codec utilities
 *
 * Re-exports from utils/aac.ts for backward compatibility.
 * This module provides:
 * - AudioSpecificConfig parsing
 * - ADTS header framing/stripping
 */

export {
  parseAudioSpecificConfig,
  wrapAacFrameWithAdts,
  buildAudioSpecificConfig,
  stripAdtsHeader,
  SAMPLING_RATES,
  type AacConfig,
} from '../utils/aac.js';
