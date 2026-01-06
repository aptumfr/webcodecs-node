/**
 * Color space conversion utilities
 */

import type { ColorMatrix, SmpteSt2086Metadata, ContentLightLevelInfo } from './types.js';

/**
 * YUV to RGB conversion coefficients for different standards
 */
const YUV_TO_RGB_COEFFICIENTS: Record<ColorMatrix, { kr: number; kb: number }> = {
  bt601: { kr: 0.299, kb: 0.114 },
  smpte170m: { kr: 0.299, kb: 0.114 },
  bt470bg: { kr: 0.299, kb: 0.114 },
  bt709: { kr: 0.2126, kb: 0.0722 },
  bt2020: { kr: 0.2627, kb: 0.0593 },
};

/**
 * Get color matrix from VideoColorSpaceInit
 */
export function getColorMatrix(matrix?: string | null): ColorMatrix {
  switch (matrix) {
    case 'bt601':
    case 'smpte170m':
    case 'bt470bg':
      return 'bt601';
    case 'bt2020-ncl':
    case 'bt2020':
      return 'bt2020';
    case 'bt709':
    case 'rgb':
    default:
      return 'bt709';
  }
}

/**
 * Convert RGBA pixel to YUV
 * @returns [Y, U, V] values in range 0-255
 */
export function rgbaToYuv(
  r: number,
  g: number,
  b: number,
  matrix: ColorMatrix = 'bt709'
): [number, number, number] {
  const { kr, kb } = YUV_TO_RGB_COEFFICIENTS[matrix];
  const kg = 1 - kr - kb;

  const y = kr * r + kg * g + kb * b;
  const u = (b - y) / (2 * (1 - kb)) + 128;
  const v = (r - y) / (2 * (1 - kr)) + 128;

  return [
    Math.max(0, Math.min(255, Math.round(y))),
    Math.max(0, Math.min(255, Math.round(u))),
    Math.max(0, Math.min(255, Math.round(v))),
  ];
}

/**
 * Convert YUV to RGBA
 * @returns [R, G, B, A] values in range 0-255
 */
export function yuvToRgba(
  y: number,
  u: number,
  v: number,
  matrix: ColorMatrix = 'bt709'
): [number, number, number, number] {
  const { kr, kb } = YUV_TO_RGB_COEFFICIENTS[matrix];
  const kg = 1 - kr - kb;

  const c = y;
  const d = u - 128;
  const e = v - 128;

  const r = c + (2 * (1 - kr)) * e;
  const g = c - (2 * kb * (1 - kb) / kg) * d - (2 * kr * (1 - kr) / kg) * e;
  const b = c + (2 * (1 - kb)) * d;

  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
    255,
  ];
}

/**
 * Create a typical HDR10 mastering display metadata
 */
export function createHdr10MasteringMetadata(
  maxLuminance: number,
  minLuminance: number = 0.0001
): SmpteSt2086Metadata {
  return {
    primaryRChromaticityX: 0.708,
    primaryRChromaticityY: 0.292,
    primaryGChromaticityX: 0.170,
    primaryGChromaticityY: 0.797,
    primaryBChromaticityX: 0.131,
    primaryBChromaticityY: 0.046,
    whitePointChromaticityX: 0.3127,
    whitePointChromaticityY: 0.3290,
    maxLuminance,
    minLuminance,
  };
}

/**
 * Create content light level info
 */
export function createContentLightLevel(
  maxCLL: number,
  maxFALL: number
): ContentLightLevelInfo {
  return { maxCLL, maxFALL };
}
