/**
 * Format conversions
 *
 * Provides pixel-level and frame-level format conversions.
 */

// Pixel-level conversions
export { rgbaToYuv, yuvToRgba } from '../color-space.js';

// Frame-level conversions
export {
  getUvAt,
  getPlaneOffset,
  convertRgbToRgb,
  convertYuvToRgb,
  convertRgbToYuv,
  convertFrameFormat,
  type FrameBuffer,
} from './frame-converter.js';

// Optimized direct conversions for encoder/decoder use
export {
  convertRgbaToI420,
  convertRgbaToNv12,
  convertNv12ToI420,
  convertI420ToNv12,
} from './frame-converter.js';

// Batch conversions with SIMD-friendly optimizations
export {
  convertRgbaToI420Fast,
  convertI420ToRgbaFast,
  swapRgbaBgraFast,
  batchConvertFrames,
  batchConvertFramesStreaming,
  type BatchFrame,
  type BatchConversionResult,
} from './batch-converter.js';
