/**
 * VideoDecoder module
 *
 * Re-exports from the main VideoDecoder.ts for backward compatibility.
 */

// Main VideoDecoder class
export { VideoDecoder } from '../VideoDecoder.js';

// Types
export type {
  CodecState,
  VideoDecoderConfig,
  VideoDecoderInit,
  VideoDecoderSupport,
} from './types.js';

// Constants
export {
  SUPPORTED_OUTPUT_FORMATS,
  DEFAULT_FLUSH_TIMEOUT,
  DEFAULT_MAX_QUEUE_SIZE,
} from './constants.js';

// Queue utilities
export { calculateMaxQueueSize } from './queue.js';
