/**
 * VideoEncoder module
 *
 * Re-exports from the main VideoEncoder.ts for backward compatibility.
 */

// Main VideoEncoder class
export { VideoEncoder } from '../VideoEncoder.js';

// Types
export type {
  CodecState,
  AvcEncoderConfig,
  HevcEncoderConfig,
  Av1EncoderConfig,
  VideoEncoderConfig,
  VideoEncoderInit,
  VideoEncoderOutputMetadata,
  VideoEncoderSupport,
  VideoEncoderEncodeOptions,
} from './types.js';

// Constants
export {
  DEFAULT_FRAMERATE,
  DEFAULT_FLUSH_TIMEOUT,
  DEFAULT_MAX_QUEUE_SIZE,
} from './constants.js';

// Queue utilities
export { calculateMaxQueueSize } from './queue.js';
