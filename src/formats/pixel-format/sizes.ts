/**
 * Pixel format size calculations
 */

import type { VideoPixelFormat, PlaneInfo } from './types.js';

/**
 * Calculate total allocation size for a frame
 */
export function getFrameAllocationSize(format: VideoPixelFormat, width: number, height: number): number {
  const chromaW = Math.ceil(width / 2);
  const chromaH = Math.ceil(height / 2);

  switch (format) {
    case 'I420':
      return width * height + 2 * chromaW * chromaH;
    case 'I420A':
      return width * height * 2 + 2 * chromaW * chromaH;
    case 'I422':
      return width * height + 2 * chromaW * height;
    case 'I422A':
      return width * height * 2 + 2 * chromaW * height;
    case 'I444':
      return width * height * 3;
    case 'I444A':
      return width * height * 4;
    case 'NV12':
      return width * height + width * chromaH;
    case 'I420P10':
    case 'I420P12':
      return (width * height + 2 * chromaW * chromaH) * 2;
    case 'I420AP10':
    case 'I420AP12':
      return (width * height * 2 + 2 * chromaW * chromaH) * 2;
    case 'I422P10':
    case 'I422P12':
      return (width * height + 2 * chromaW * height) * 2;
    case 'I422AP10':
    case 'I422AP12':
      return (width * height * 2 + 2 * chromaW * height) * 2;
    case 'I444P10':
    case 'I444P12':
      return width * height * 3 * 2;
    case 'I444AP10':
    case 'I444AP12':
      return width * height * 4 * 2;
    case 'P010':
      return (width * height + width * chromaH) * 2;
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
      return width * height * 4;
    default:
      return width * height * 4;
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
      return 3;
    case 'I420A':
    case 'I422A':
    case 'I444A':
    case 'I420AP10':
    case 'I422AP10':
    case 'I444AP10':
    case 'I420AP12':
    case 'I422AP12':
    case 'I444AP12':
      return 4;
    case 'NV12':
    case 'P010':
      return 2;
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
      return 1;
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
    case 'I444A':
      return { width, height, bytesPerPixel: 1 };
    case 'NV12':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 1 };
      return { width, height: chromaH, bytesPerPixel: 2 };
    case 'I420P10':
    case 'I420P12':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 2 };
      return { width: chromaW, height: chromaH, bytesPerPixel: 2 };
    case 'I420AP10':
    case 'I420AP12':
      if (planeIndex === 0 || planeIndex === 3) return { width, height, bytesPerPixel: 2 };
      return { width: chromaW, height: chromaH, bytesPerPixel: 2 };
    case 'I422P10':
    case 'I422P12':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 2 };
      return { width: chromaW, height, bytesPerPixel: 2 };
    case 'I422AP10':
    case 'I422AP12':
      if (planeIndex === 0 || planeIndex === 3) return { width, height, bytesPerPixel: 2 };
      return { width: chromaW, height, bytesPerPixel: 2 };
    case 'I444P10':
    case 'I444P12':
    case 'I444AP10':
    case 'I444AP12':
      return { width, height, bytesPerPixel: 2 };
    case 'P010':
      if (planeIndex === 0) return { width, height, bytesPerPixel: 2 };
      return { width, height: chromaH, bytesPerPixel: 4 };
    case 'RGBA':
    case 'RGBX':
    case 'BGRA':
    case 'BGRX':
      return { width, height, bytesPerPixel: 4 };
    default:
      return { width, height, bytesPerPixel: 4 };
  }
}
