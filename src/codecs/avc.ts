/**
 * AVC (H.264) codec utilities
 *
 * Re-exports from utils/avc.ts for backward compatibility.
 * This module provides:
 * - AVCDecoderConfigurationRecord parsing
 * - Annex B <-> avcC format conversion
 * - SPS/PPS parameter set extraction
 */

export {
  parseAvcDecoderConfig,
  convertAvccToAnnexB,
  splitAnnexBNals,
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
  convertAnnexBToAvcc,
  type AvcConfig,
} from '../utils/avc.js';
