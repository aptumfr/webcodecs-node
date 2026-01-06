/**
 * Codec validation module
 *
 * Provides WebCodecs-compliant validation for codec strings and configurations.
 */

// Video codec validation
export {
  validateVideoCodec,
  type CodecValidationResult,
} from './video.js';

// Audio codec validation
export {
  validateAudioCodec,
  type AudioCodecValidationResult,
} from './audio.js';

// Config validation
export {
  validateVideoDecoderConfig,
  validateVideoEncoderConfig,
  validateAudioDecoderConfig,
  validateAudioEncoderConfig,
} from './config.js';
