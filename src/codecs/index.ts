/**
 * Codecs module
 *
 * Provides codec-specific utilities and validation functions.
 */

// Validation
export * from './validation/index.js';

// AVC (H.264) utilities
export {
  parseAvcDecoderConfig,
  convertAvccToAnnexB,
  splitAnnexBNals,
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
  convertAnnexBToAvcc,
  type AvcConfig,
} from './avc.js';

// HEVC (H.265) utilities
export {
  parseHvccDecoderConfig,
  convertHvccToAnnexB,
  splitHevcAnnexBNals,
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
  type HvccConfig,
} from './hevc.js';

// AAC utilities
export {
  parseAudioSpecificConfig,
  wrapAacFrameWithAdts,
  buildAudioSpecificConfig,
  stripAdtsHeader,
  SAMPLING_RATES,
  type AacConfig,
} from './aac.js';
