/**
 * Color space module
 *
 * Provides color space types and conversion utilities for WebCodecs.
 */

// Types
export {
  VideoColorSpace,
  HDR10_DISPLAY_PRIMARIES,
  type ColorMatrix,
  type SmpteSt2086Metadata,
  type ContentLightLevelInfo,
  type HdrMetadata,
  type VideoColorSpaceInit,
} from './types.js';

// Conversion utilities
export {
  getColorMatrix,
  rgbaToYuv,
  yuvToRgba,
  createHdr10MasteringMetadata,
  createContentLightLevel,
} from './convert.js';

// FFmpeg color space mappings
export {
  AVCOL_PRI_VALUES,
  AVCOL_TRC_VALUES,
  AVCOL_SPC_VALUES,
  AVCOL_RANGE_VALUES,
} from './maps.js';

// Extraction utilities
export {
  avColorPrimariesToWebCodecs,
  avColorTransferToWebCodecs,
  avColorSpaceToWebCodecs,
  avColorRangeToWebCodecs,
  extractColorSpaceFromFrame,
} from './extract.js';
