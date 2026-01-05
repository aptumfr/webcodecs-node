/**
 * Pixel format definitions and utilities
 */

export type VideoPixelFormat =
  | 'I420'
  | 'I420A'
  | 'I422'
  | 'I422A'
  | 'I444'
  | 'I444A'
  | 'NV12'
  | 'RGBA'
  | 'RGBX'
  | 'BGRA'
  | 'BGRX'
  // 10-bit formats (16-bit container with 10-bit data in upper bits)
  | 'I420P10'
  | 'I420A10'
  | 'I422P10'
  | 'I422A10'
  | 'I444P10'
  | 'I444A10'
  | 'P010'
  // 12-bit formats (16-bit container with 12-bit data)
  | 'I420P12'
  | 'I420A12'
  | 'I422P12'
  | 'I422A12'
  | 'I444P12'
  | 'I444A12';

/**
 * Information about a single plane in a pixel format
 */
export interface PlaneInfo {
  width: number;
  height: number;
  bytesPerPixel: number;
}

/**
 * Calculate total allocation size for a frame
 */
export function getFrameAllocationSize(format: VideoPixelFormat, width: number, height: number): number {
  const chromaW = Math.ceil(width / 2);
  const chromaH = Math.ceil(height / 2);

  switch (format) {
    case 'I420':
      // Y: width * height, U: (width/2) * (height/2), V: (width/2) * (height/2)
      return width * height + 2 * chromaW * chromaH;
    case 'I420A':
      // I420 + Alpha plane (width * height)
      return width * height * 2 + 2 * chromaW * chromaH;
    case 'I422':
      // Y: width * height, U: (width/2) * height, V: (width/2) * height
      return width * height + 2 * chromaW * height;
    case 'I422A':
      // I422 + Alpha plane (width * height)
      return width * height * 2 + 2 * chromaW * height;
    case 'I444':
      // Y: width * height, U: width * height, V: width * height
      return width * height * 3;
    case 'I444A':
      // I444 + Alpha plane (width * height)
      return width * height * 4;
    case 'NV12':
      // Y: width * height, UV interleaved: width * (height/2)
      return width * height + width * chromaH;
    // 10-bit and 12-bit formats: 2 bytes per sample (16-bit container)
    case 'I420P10':
    case 'I420P12':
      // Y: width * height * 2, U: chromaW * chromaH * 2, V: chromaW * chromaH * 2
      return (width * height + 2 * chromaW * chromaH) * 2;
    case 'I420A10':
    case 'I420A12':
      // I420 high-bit-depth + Alpha plane
      return (width * height * 2 + 2 * chromaW * chromaH) * 2;
    case 'I422P10':
    case 'I422P12':
      // Y: width * height * 2, U: chromaW * height * 2, V: chromaW * height * 2
      return (width * height + 2 * chromaW * height) * 2;
    case 'I422A10':
    case 'I422A12':
      // I422 high-bit-depth + Alpha plane
      return (width * height * 2 + 2 * chromaW * height) * 2;
    case 'I444P10':
    case 'I444P12':
      // Y, U, V all full size, 2 bytes each
      return width * height * 3 * 2;
    case 'I444A10':
    case 'I444A12':
      // I444 high-bit-depth + Alpha plane
      return width * height * 4 * 2;
    case 'P010':
      // Y: width * height * 2, UV interleaved: width * chromaH * 2
      return (width * height + width * chromaH) * 2;
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
      return width * height * 4;
    default:
      return width * height * 4; // Assume RGBA as fallback
  }
}

/**
 * Get number of planes for a pixel format
 */
export function getPlaneCount(format: VideoPixelFormat): number {
  switch (format) {
    case 'I420':
    case 'I422':
    case 'I444':
    case 'I420P10':
    case 'I422P10':
    case 'I444P10':
    case 'I420P12':
    case 'I422P12':
    case 'I444P12':
      return 3; // Y, U, V
    case 'I420A':
    case 'I422A':
    case 'I444A':
    case 'I420A10':
    case 'I422A10':
    case 'I444A10':
    case 'I420A12':
    case 'I422A12':
    case 'I444A12':
      return 4; // Y, U, V, A
    case 'NV12':
    case 'P010':
      return 2; // Y, UV interleaved
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
      return 1; // Single plane
    default:
      return 1;
  }
}

/**
 * Get plane info for a format at a specific plane index
 */
export function getPlaneInfo(
  format: VideoPixelFormat,
  width: number,
  height: number,
  planeIndex: number
): PlaneInfo {
  const chromaW = Math.ceil(width / 2);
  const chromaH = Math.ceil(height / 2);

  switch (format) {
    case 'I420':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 1 };
      return { width: chromaW, height: chromaH, bytesPerPixel: 1 };
    case 'I420A':
      if (planeIndex === 0 || planeIndex === 3) return { width, height, bytesPerPixel: 1 };
      return { width: chromaW, height: chromaH, bytesPerPixel: 1 };
    case 'I422':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 1 };
      return { width: chromaW, height, bytesPerPixel: 1 };
    case 'I422A':
      if (planeIndex === 0 || planeIndex === 3) return { width, height, bytesPerPixel: 1 };
      return { width: chromaW, height, bytesPerPixel: 1 };
    case 'I444':
      return { width, height, bytesPerPixel: 1 };
    case 'I444A':
      return { width, height, bytesPerPixel: 1 };
    case 'NV12':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 1 };
      return { width, height: chromaH, bytesPerPixel: 2 }; // UV interleaved
    // 10-bit and 12-bit formats: 2 bytes per sample (16-bit container)
    case 'I420P10':
    case 'I420P12':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 2 };
      return { width: chromaW, height: chromaH, bytesPerPixel: 2 };
    case 'I420A10':
    case 'I420A12':
      if (planeIndex === 0 || planeIndex === 3) return { width, height, bytesPerPixel: 2 };
      return { width: chromaW, height: chromaH, bytesPerPixel: 2 };
    case 'I422P10':
    case 'I422P12':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 2 };
      return { width: chromaW, height, bytesPerPixel: 2 };
    case 'I422A10':
    case 'I422A12':
      if (planeIndex === 0 || planeIndex === 3) return { width, height, bytesPerPixel: 2 };
      return { width: chromaW, height, bytesPerPixel: 2 };
    case 'I444P10':
    case 'I444P12':
      return { width, height, bytesPerPixel: 2 };
    case 'I444A10':
    case 'I444A12':
      return { width, height, bytesPerPixel: 2 };
    case 'P010':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 2 };
      return { width, height: chromaH, bytesPerPixel: 4 }; // UV interleaved, 2 bytes each
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
      return { width, height, bytesPerPixel: 4 };
    default:
      return { width, height, bytesPerPixel: 4 };
  }
}

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
    format === 'I420A10' || format === 'I422A10' || format === 'I444A10' ||
    format === 'I420A12' || format === 'I422A12' || format === 'I444A12';
}

/**
 * Check if a format is 10-bit (high bit depth)
 */
export function is10BitFormat(format: VideoPixelFormat): boolean {
  return format === 'I420P10' || format === 'I422P10' || format === 'I444P10' || format === 'P010' ||
    format === 'I420A10' || format === 'I422A10' || format === 'I444A10';
}

/**
 * Check if a format is 12-bit (high bit depth)
 */
export function is12BitFormat(format: VideoPixelFormat): boolean {
  return format === 'I420P12' || format === 'I422P12' || format === 'I444P12' ||
    format === 'I420A12' || format === 'I422A12' || format === 'I444A12';
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
    case 'I420A10':
    case 'I420A12':
      return 'I420A';
    case 'I422P10':
    case 'I422P12':
      return 'I422';
    case 'I422A10':
    case 'I422A12':
      return 'I422A';
    case 'I444P10':
    case 'I444P12':
      return 'I444';
    case 'I444A10':
    case 'I444A12':
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
    case 'I420A': return 'I420A10';
    case 'I422': return 'I422P10';
    case 'I422A': return 'I422A10';
    case 'I444': return 'I444P10';
    case 'I444A': return 'I444A10';
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
    case 'I420A': return 'I420A12';
    case 'I422': return 'I422P12';
    case 'I422A': return 'I422A12';
    case 'I444': return 'I444P12';
    case 'I444A': return 'I444A12';
    default: return format;
  }
}
