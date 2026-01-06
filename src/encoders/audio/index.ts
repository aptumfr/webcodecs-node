/**
 * AudioEncoder module
 *
 * Re-exports from the main AudioEncoder.ts for backward compatibility.
 */

// Main AudioEncoder class
export { AudioEncoder } from '../AudioEncoder.js';

// Types
export type {
  CodecState,
  OpusEncoderConfig,
  AacEncoderConfig,
  AudioEncoderConfig,
  AudioEncoderInit,
  AudioEncoderOutputMetadata,
  AudioEncoderSupport,
} from './types.js';

// Constants
export {
  DEFAULT_FLUSH_TIMEOUT,
  MAX_QUEUE_SIZE,
  OPUS_ENCODER_SAMPLE_RATE,
} from './constants.js';
