/**
 * AudioDecoder module
 *
 * Re-exports from the main AudioDecoder.ts for backward compatibility.
 */

// Main AudioDecoder class
export { AudioDecoder } from '../AudioDecoder.js';

// Types
export type {
  CodecState,
  AudioDecoderConfig,
  AudioDecoderInit,
  AudioDecoderSupport,
} from './types.js';

// Constants
export {
  DEFAULT_FLUSH_TIMEOUT,
  MAX_QUEUE_SIZE,
} from './constants.js';
