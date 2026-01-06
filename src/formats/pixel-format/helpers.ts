/**
 * Pixel format helper functions
 */

import type { VideoPixelFormat } from './types.js';

/**
 * Check if a format is RGB-based (as opposed to YUV)
 */
export function isRgbFormat(format: VideoPixelFormat): boolean {
  return format === 'RGBA' || format === 'RGBX' || format === 'BGRA' || format === 'BGRX';
}

/**
 * Check if a format is YUV-based
 */
export function isYuvFormat(format: VideoPixelFormat): boolean {
  return !isRgbFormat(format);
}

/**
 * Check if a format uses BGR channel order
 */
export function isBgrFormat(format: VideoPixelFormat): boolean {
  return format === 'BGRA' || format === 'BGRX';
}

/**
 * Check if a format has an alpha channel
 */
export function hasAlphaChannel(format: VideoPixelFormat): boolean {
  return format === 'RGBA' || format === 'BGRA' ||
    format === 'I420A' || format === 'I422A' || format === 'I444A' ||
    format === 'I420AP10' || format === 'I422AP10' || format === 'I444AP10' ||
    format === 'I420AP12' || format === 'I422AP12' || format === 'I444AP12';
}

/**
 * Check if a format is 10-bit (high bit depth)
 */
export function is10BitFormat(format: VideoPixelFormat): boolean {
  return format === 'I420P10' || format === 'I422P10' || format === 'I444P10' || format === 'P010' ||
    format === 'I420AP10' || format === 'I422AP10' || format === 'I444AP10';
}

/**
 * Check if a format is 12-bit (high bit depth)
 */
export function is12BitFormat(format: VideoPixelFormat): boolean {
  return format === 'I420P12' || format === 'I422P12' || format === 'I444P12' ||
    format === 'I420AP12' || format === 'I422AP12' || format === 'I444AP12';
}

/**
 * Check if a format uses high bit depth (10 or 12 bit)
 */
export function isHighBitDepthFormat(format: VideoPixelFormat): boolean {
  return is10BitFormat(format) || is12BitFormat(format);
}

/**
 * Get the bit depth for a format (8, 10, or 12)
 */
export function getBitDepth(format: VideoPixelFormat): number {
  if (is12BitFormat(format)) return 12;
  if (is10BitFormat(format)) return 10;
  return 8;
}

/**
 * Get the 8-bit equivalent of a high bit depth format
 */
export function get8BitEquivalent(format: VideoPixelFormat): VideoPixelFormat {
  switch (format) {
    case 'I420P10':
    case 'I420P12':
      return 'I420';
    case 'I420AP10':
    case 'I420AP12':
      return 'I420A';
    case 'I422P10':
    case 'I422P12':
      return 'I422';
    case 'I422AP10':
    case 'I422AP12':
      return 'I422A';
    case 'I444P10':
    case 'I444P12':
      return 'I444';
    case 'I444AP10':
    case 'I444AP12':
      return 'I444A';
    case 'P010': return 'NV12';
    default: return format;
  }
}

/**
 * Get the 10-bit equivalent of an 8-bit format
 */
export function get10BitEquivalent(format: VideoPixelFormat): VideoPixelFormat {
  switch (format) {
    case 'I420': return 'I420P10';
    case 'I420A': return 'I420AP10';
    case 'I422': return 'I422P10';
    case 'I422A': return 'I422AP10';
    case 'I444': return 'I444P10';
    case 'I444A': return 'I444AP10';
    case 'NV12': return 'P010';
    default: return format;
  }
}

/**
 * Get the 12-bit equivalent of an 8-bit format
 */
export function get12BitEquivalent(format: VideoPixelFormat): VideoPixelFormat {
  switch (format) {
    case 'I420': return 'I420P12';
    case 'I420A': return 'I420AP12';
    case 'I422': return 'I422P12';
    case 'I422A': return 'I422AP12';
    case 'I444': return 'I444P12';
    case 'I444A': return 'I444AP12';
    default: return format;
  }
}
