/**
 * Color space extraction utilities
 *
 * Convert FFmpeg color space values to WebCodecs format
 */

import type { VideoColorSpaceInit } from './types.js';
import {
  AVCOL_PRI_VALUES,
  AVCOL_TRC_VALUES,
  AVCOL_SPC_VALUES,
  AVCOL_RANGE_VALUES,
} from './maps.js';

/**
 * Convert FFmpeg AVColorPrimaries to WebCodecs primaries string
 */
export function avColorPrimariesToWebCodecs(primaries: number): VideoColorSpaceInit['primaries'] | undefined {
  switch (primaries) {
    case AVCOL_PRI_VALUES.BT709:
      return 'bt709';
    case AVCOL_PRI_VALUES.BT470BG:
      return 'bt470bg';
    case AVCOL_PRI_VALUES.SMPTE170M:
    case AVCOL_PRI_VALUES.SMPTE240M:
      return 'smpte170m';
    case AVCOL_PRI_VALUES.BT2020:
      return 'bt2020';
    case AVCOL_PRI_VALUES.SMPTE432:
      return 'smpte432';
    default:
      return undefined;
  }
}

/**
 * Convert FFmpeg AVColorTransferCharacteristic to WebCodecs transfer string
 */
export function avColorTransferToWebCodecs(transfer: number): VideoColorSpaceInit['transfer'] | undefined {
  switch (transfer) {
    case AVCOL_TRC_VALUES.BT709:
    case AVCOL_TRC_VALUES.BT2020_10:
    case AVCOL_TRC_VALUES.BT2020_12:
      return 'bt709';
    case AVCOL_TRC_VALUES.SMPTE170M:
    case AVCOL_TRC_VALUES.SMPTE240M:
      return 'smpte170m';
    case AVCOL_TRC_VALUES.IEC61966_2_1:
      return 'iec61966-2-1';
    case AVCOL_TRC_VALUES.LINEAR:
      return 'linear';
    case AVCOL_TRC_VALUES.SMPTE2084:
      return 'pq';
    case AVCOL_TRC_VALUES.ARIB_STD_B67:
      return 'hlg';
    default:
      return undefined;
  }
}

/**
 * Convert FFmpeg AVColorSpace (matrix) to WebCodecs matrix string
 */
export function avColorSpaceToWebCodecs(colorSpace: number): VideoColorSpaceInit['matrix'] | undefined {
  switch (colorSpace) {
    case AVCOL_SPC_VALUES.RGB:
      return 'rgb';
    case AVCOL_SPC_VALUES.BT709:
      return 'bt709';
    case AVCOL_SPC_VALUES.BT470BG:
      return 'bt470bg';
    case AVCOL_SPC_VALUES.SMPTE170M:
    case AVCOL_SPC_VALUES.SMPTE240M:
      return 'smpte170m';
    case AVCOL_SPC_VALUES.BT2020_NCL:
    case AVCOL_SPC_VALUES.BT2020_CL:
      return 'bt2020-ncl';
    default:
      return undefined;
  }
}

/**
 * Convert FFmpeg AVColorRange to WebCodecs fullRange boolean
 */
export function avColorRangeToWebCodecs(range: number): boolean | undefined {
  switch (range) {
    case AVCOL_RANGE_VALUES.JPEG:
      return true;
    case AVCOL_RANGE_VALUES.MPEG:
      return false;
    default:
      return undefined;
  }
}

/**
 * Extract VideoColorSpaceInit from FFmpeg frame color properties
 */
export function extractColorSpaceFromFrame(frame: {
  colorPrimaries?: number;
  colorTrc?: number;
  colorSpace?: number;
  colorRange?: number;
}): VideoColorSpaceInit | undefined {
  const primaries = frame.colorPrimaries !== undefined
    ? avColorPrimariesToWebCodecs(frame.colorPrimaries)
    : undefined;
  const transfer = frame.colorTrc !== undefined
    ? avColorTransferToWebCodecs(frame.colorTrc)
    : undefined;
  const matrix = frame.colorSpace !== undefined
    ? avColorSpaceToWebCodecs(frame.colorSpace)
    : undefined;
  const fullRange = frame.colorRange !== undefined
    ? avColorRangeToWebCodecs(frame.colorRange)
    : undefined;

  if (primaries === undefined && transfer === undefined &&
      matrix === undefined && fullRange === undefined) {
    return undefined;
  }

  const result: VideoColorSpaceInit = {};
  if (primaries !== undefined) result.primaries = primaries;
  if (transfer !== undefined) result.transfer = transfer;
  if (matrix !== undefined) result.matrix = matrix;
  if (fullRange !== undefined) result.fullRange = fullRange;

  return result;
}
