/**
 * HEVC (H.265) codec utilities
 *
 * Re-exports from utils/hevc.ts for backward compatibility.
 * This module provides:
 * - HEVCDecoderConfigurationRecord (HVCC) parsing
 * - Annex B <-> HVCC format conversion
 * - VPS/SPS/PPS parameter set extraction
 */

export {
  parseHvccDecoderConfig,
  convertHvccToAnnexB,
  splitHevcAnnexBNals,
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
  type HvccConfig,
} from '../utils/hevc.js';
