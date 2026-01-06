/**
 * ImageDecoder module
 *
 * Re-exports from the main ImageDecoder.ts for backward compatibility.
 */

// Main ImageDecoder class
export { ImageDecoder } from '../ImageDecoder.js';

// Types
export type {
  ColorSpaceConversion,
  PremultiplyAlpha,
  ImageDecoderInit,
  ImageDecodeOptions,
  ImageDecodeResult,
} from './types.js';

// Track classes
export {
  ImageTrack,
  ImageTrackListClass as ImageTrackList,
  createImageTrackList,
  type ImageTrackList as ImageTrackListType,
} from './tracks.js';

// Orientation utilities
export {
  parseExifOrientation,
  applyOrientation,
} from './orientation.js';

// Stream utilities
export {
  isReadableStream,
  readStreamToBuffer,
} from './stream.js';
