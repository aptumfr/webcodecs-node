/**
 * Pixel format module
 *
 * Provides pixel format types and utilities for WebCodecs video frames.
 */

// Types
export type { VideoPixelFormat, PlaneInfo } from './types.js';

// Size calculations
export {
  getFrameAllocationSize,
  getPlaneCount,
  getPlaneInfo,
} from './sizes.js';

// Helper functions
export {
  isRgbFormat,
  isYuvFormat,
  isBgrFormat,
  hasAlphaChannel,
  is10BitFormat,
  is12BitFormat,
  isHighBitDepthFormat,
  getBitDepth,
  get8BitEquivalent,
  get10BitEquivalent,
  get12BitEquivalent,
} from './helpers.js';
