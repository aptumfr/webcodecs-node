/**
 * Frame format conversion utilities
 *
 * Standalone functions for converting video frame data between pixel formats.
 * These functions operate on raw pixel buffers without requiring a VideoFrame instance.
 */

import { rgbaToYuv, yuvToRgba, getColorMatrix, type ColorMatrix } from '../color-space.js';
import type { VideoColorSpaceInit } from '../color-space.js';
import { getPlaneInfo, isRgbFormat, isBgrFormat, type VideoPixelFormat } from '../pixel-formats.js';
import { acquireBuffer, releaseBuffer } from '../../utils/buffer-pool.js';

// Re-export VideoPixelFormat for backwards compatibility
export type { VideoPixelFormat };

/**
 * Frame buffer descriptor
 */
export interface FrameBuffer {
  data: Uint8Array;
  format: VideoPixelFormat;
  width: number;
  height: number;
}

/**
 * Get UV values at a specific position in a YUV frame
 */
export function getUvAt(
  data: Uint8Array,
  format: VideoPixelFormat,
  width: number,
  height: number,
  x: number,
  y: number
): [number, number] {
  if (format === 'I420' || format === 'I420A') {
    const chromaW = Math.ceil(width / 2);
    const chromaH = Math.ceil(height / 2);
    const ySize = width * height;
    const uvSize = chromaW * chromaH;

    const cx = Math.floor(x / 2);
    const cy = Math.floor(y / 2);

    const u = data[ySize + cy * chromaW + cx];
    const v = data[ySize + uvSize + cy * chromaW + cx];
    return [u, v];
  } else if (format === 'NV12') {
    const ySize = width * height;
    const cx = Math.floor(x / 2) * 2;
    const cy = Math.floor(y / 2);

    const u = data[ySize + cy * width + cx];
    const v = data[ySize + cy * width + cx + 1];
    return [u, v];
  } else if (format === 'I422') {
    const chromaW = Math.ceil(width / 2);
    const ySize = width * height;
    const uvSize = chromaW * height;

    const cx = Math.floor(x / 2);

    const u = data[ySize + y * chromaW + cx];
    const v = data[ySize + uvSize + y * chromaW + cx];
    return [u, v];
  } else if (format === 'I444') {
    const ySize = width * height;

    const u = data[ySize + y * width + x];
    const v = data[2 * ySize + y * width + x];
    return [u, v];
  }

  return [128, 128];
}

/**
 * Get the byte offset for a plane in a frame buffer
 */
export function getPlaneOffset(
  format: VideoPixelFormat,
  width: number,
  height: number,
  planeIndex: number
): number {
  const chromaW = Math.ceil(width / 2);
  const chromaH = Math.ceil(height / 2);

  switch (format) {
    case 'I420':
    case 'I420A': {
      const ySize = width * height;
      const uvSize = chromaW * chromaH;
      if (planeIndex === 0) return 0;
      if (planeIndex === 1) return ySize;
      if (planeIndex === 2) return ySize + uvSize;
      if (planeIndex === 3) return ySize + 2 * uvSize;
      return 0;
    }
    case 'I422': {
      const ySize = width * height;
      const uvSize = chromaW * height;
      if (planeIndex === 0) return 0;
      if (planeIndex === 1) return ySize;
      if (planeIndex === 2) return ySize + uvSize;
      return 0;
    }
    case 'I444': {
      const planeSize = width * height;
      return planeIndex * planeSize;
    }
    case 'NV12': {
      if (planeIndex === 0) return 0;
      return width * height;
    }
    default:
      return 0;
  }
}

/**
 * Convert RGB to RGB with potential channel swap (RGBA <-> BGRA)
 */
export function convertRgbToRgb(
  src: FrameBuffer,
  dest: Uint8Array,
  destFormat: VideoPixelFormat,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number
): void {
  const srcStride = src.width * 4;
  const swapRB = isBgrFormat(src.format) !== isBgrFormat(destFormat);

  let destOffset = 0;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const srcOffset = (srcY + y) * srcStride + (srcX + x) * 4;
      if (swapRB) {
        dest[destOffset++] = src.data[srcOffset + 2];
        dest[destOffset++] = src.data[srcOffset + 1];
        dest[destOffset++] = src.data[srcOffset];
        dest[destOffset++] = src.data[srcOffset + 3];
      } else {
        dest[destOffset++] = src.data[srcOffset];
        dest[destOffset++] = src.data[srcOffset + 1];
        dest[destOffset++] = src.data[srcOffset + 2];
        dest[destOffset++] = src.data[srcOffset + 3];
      }
    }
  }
}

/**
 * Convert YUV to RGB format
 * @param colorMatrix Optional color matrix for conversion (default: bt709)
 */
export function convertYuvToRgb(
  src: FrameBuffer,
  dest: Uint8Array,
  destFormat: VideoPixelFormat,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
  colorMatrix: ColorMatrix = 'bt709'
): void {
  const isBgr = isBgrFormat(destFormat);
  const yOffset = getPlaneOffset(src.format, src.width, src.height, 0);
  const yStride = src.width;

  let destOffset = 0;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const absX = srcX + x;
      const absY = srcY + y;

      const yVal = src.data[yOffset + absY * yStride + absX];
      const [uVal, vVal] = getUvAt(src.data, src.format, src.width, src.height, absX, absY);
      const [r, g, b, a] = yuvToRgba(yVal, uVal, vVal, colorMatrix);

      if (isBgr) {
        dest[destOffset++] = b;
        dest[destOffset++] = g;
        dest[destOffset++] = r;
        dest[destOffset++] = a;
      } else {
        dest[destOffset++] = r;
        dest[destOffset++] = g;
        dest[destOffset++] = b;
        dest[destOffset++] = a;
      }
    }
  }
}

/**
 * Convert RGB to YUV format
 * @param colorMatrix Optional color matrix for conversion (default: bt709)
 */
export function convertRgbToYuv(
  src: FrameBuffer,
  dest: Uint8Array,
  destFormat: VideoPixelFormat,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
  colorMatrix: ColorMatrix = 'bt709'
): void {
  const isBgr = isBgrFormat(src.format);
  const srcStride = src.width * 4;

  const yPlaneSize = srcW * srcH;
  const chromaW = Math.ceil(srcW / 2);
  const chromaH = Math.ceil(srcH / 2);

  // Fill Y plane
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const srcOffset = (srcY + y) * srcStride + (srcX + x) * 4;
      const r = isBgr ? src.data[srcOffset + 2] : src.data[srcOffset];
      const g = src.data[srcOffset + 1];
      const b = isBgr ? src.data[srcOffset] : src.data[srcOffset + 2];

      const [yVal] = rgbaToYuv(r, g, b, colorMatrix);
      dest[y * srcW + x] = yVal;
    }
  }

  // Fill U, V planes
  if (destFormat === 'I420' || destFormat === 'I420A') {
    const uOffset = yPlaneSize;
    const vOffset = yPlaneSize + chromaW * chromaH;

    for (let y = 0; y < chromaH; y++) {
      for (let x = 0; x < chromaW; x++) {
        const srcPx = Math.min((srcX + x * 2), src.width - 1);
        const srcPy = Math.min((srcY + y * 2), src.height - 1);
        const srcOffset = srcPy * srcStride + srcPx * 4;

        const r = isBgr ? src.data[srcOffset + 2] : src.data[srcOffset];
        const g = src.data[srcOffset + 1];
        const b = isBgr ? src.data[srcOffset] : src.data[srcOffset + 2];

        const [, uVal, vVal] = rgbaToYuv(r, g, b, colorMatrix);
        dest[uOffset + y * chromaW + x] = uVal;
        dest[vOffset + y * chromaW + x] = vVal;
      }
    }

    if (destFormat === 'I420A') {
      const aOffset = yPlaneSize + 2 * chromaW * chromaH;
      for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < srcW; x++) {
          const srcOffset = (srcY + y) * srcStride + (srcX + x) * 4;
          dest[aOffset + y * srcW + x] = src.data[srcOffset + 3];
        }
      }
    }
  } else if (destFormat === 'NV12') {
    const uvOffset = yPlaneSize;

    for (let y = 0; y < chromaH; y++) {
      for (let x = 0; x < chromaW; x++) {
        const srcPx = Math.min((srcX + x * 2), src.width - 1);
        const srcPy = Math.min((srcY + y * 2), src.height - 1);
        const srcOffset = srcPy * srcStride + srcPx * 4;

        const r = isBgr ? src.data[srcOffset + 2] : src.data[srcOffset];
        const g = src.data[srcOffset + 1];
        const b = isBgr ? src.data[srcOffset] : src.data[srcOffset + 2];

        const [, uVal, vVal] = rgbaToYuv(r, g, b, colorMatrix);
        dest[uvOffset + y * srcW + x * 2] = uVal;
        dest[uvOffset + y * srcW + x * 2 + 1] = vVal;
      }
    }
  }
}

/**
 * Clamp a value to the 0-255 byte range
 */
function clampByte(val: number): number {
  return Math.max(0, Math.min(255, val));
}

/**
 * Convert RGBA buffer to I420 (YUV420P) planar format
 * Optimized direct conversion without intermediate allocations
 */
export function convertRgbaToI420(rgba: Uint8Array | Buffer, width: number, height: number): Uint8Array {
  const ySize = width * height;
  const uvSize = (width / 2) * (height / 2);
  const out = new Uint8Array(ySize + 2 * uvSize);
  const yPlane = out.subarray(0, ySize);
  const uPlane = out.subarray(ySize, ySize + uvSize);
  const vPlane = out.subarray(ySize + uvSize);

  for (let j = 0; j < height; j += 2) {
    for (let i = 0; i < width; i += 2) {
      let uSum = 0;
      let vSum = 0;

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = i + dx;
          const y = j + dy;
          const idx = (y * width + x) * 4;
          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];

          // BT.601 conversion
          const yVal = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
          yPlane[y * width + x] = clampByte(yVal);

          const uVal = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
          const vVal = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
          uSum += uVal;
          vSum += vVal;
        }
      }

      uPlane[(j / 2) * (width / 2) + i / 2] = clampByte(uSum >> 2);
      vPlane[(j / 2) * (width / 2) + i / 2] = clampByte(vSum >> 2);
    }
  }

  return out;
}

/**
 * Convert RGBA buffer to NV12 (Y plane + interleaved UV plane)
 */
export function convertRgbaToNv12(rgba: Uint8Array | Buffer, width: number, height: number): Uint8Array {
  const ySize = width * height;
  const uvSize = (width / 2) * (height / 2) * 2; // Interleaved UV
  const out = new Uint8Array(ySize + uvSize);
  const yPlane = out.subarray(0, ySize);
  const uvPlane = out.subarray(ySize);

  for (let j = 0; j < height; j += 2) {
    for (let i = 0; i < width; i += 2) {
      let uSum = 0;
      let vSum = 0;

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = i + dx;
          const y = j + dy;
          const idx = (y * width + x) * 4;

          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];

          // BT.601 coefficients
          const yVal = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
          yPlane[y * width + x] = clampByte(yVal);

          const uVal = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
          const vVal = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
          uSum += uVal;
          vSum += vVal;
        }
      }

      // NV12 has interleaved UV: UVUVUV...
      const uvIdx = (j / 2) * width + i;
      uvPlane[uvIdx] = clampByte(uSum >> 2);     // U
      uvPlane[uvIdx + 1] = clampByte(vSum >> 2); // V
    }
  }

  return out;
}

/**
 * Convert NV12 (Y + interleaved UV) to I420 (Y + U + V planar)
 */
export function convertNv12ToI420(nv12: Uint8Array | Buffer, width: number, height: number): Uint8Array {
  const ySize = width * height;
  const uvWidth = width / 2;
  const uvHeight = height / 2;
  const uvPlaneSize = uvWidth * uvHeight;
  const uvInterleavedSize = uvPlaneSize * 2;

  const out = new Uint8Array(ySize + 2 * uvPlaneSize);
  const yPlane = out.subarray(0, ySize);
  const uPlane = out.subarray(ySize, ySize + uvPlaneSize);
  const vPlane = out.subarray(ySize + uvPlaneSize);

  // Copy Y plane directly
  yPlane.set(nv12.subarray(0, ySize));

  // De-interleave UV plane
  const uvInterleaved = nv12.subarray(ySize, ySize + uvInterleavedSize);
  for (let i = 0; i < uvPlaneSize; i++) {
    uPlane[i] = uvInterleaved[i * 2];
    vPlane[i] = uvInterleaved[i * 2 + 1];
  }

  return out;
}

/**
 * Convert I420 (Y + U + V planar) to NV12 (Y + interleaved UV)
 */
export function convertI420ToNv12(i420: Uint8Array | Buffer, width: number, height: number): Uint8Array {
  const ySize = width * height;
  const uvWidth = width / 2;
  const uvHeight = height / 2;
  const uvPlaneSize = uvWidth * uvHeight;

  const out = new Uint8Array(ySize + uvPlaneSize * 2);
  const yPlane = out.subarray(0, ySize);
  const uvPlane = out.subarray(ySize);

  // Copy Y plane directly
  yPlane.set(i420.subarray(0, ySize));

  // Interleave U and V planes
  const uPlane = i420.subarray(ySize, ySize + uvPlaneSize);
  const vPlane = i420.subarray(ySize + uvPlaneSize);
  for (let i = 0; i < uvPlaneSize; i++) {
    uvPlane[i * 2] = uPlane[i];
    uvPlane[i * 2 + 1] = vPlane[i];
  }

  return out;
}

/**
 * Convert between any two pixel formats
 * @param colorSpace Optional color space for matrix selection (default: bt709)
 */
export function convertFrameFormat(
  src: FrameBuffer,
  dest: Uint8Array,
  destFormat: VideoPixelFormat,
  srcX: number = 0,
  srcY: number = 0,
  srcW?: number,
  srcH?: number,
  colorSpace?: VideoColorSpaceInit
): void {
  const width = srcW ?? src.width;
  const height = srcH ?? src.height;
  const colorMatrix = getColorMatrix(colorSpace?.matrix);

  const srcIsRgb = isRgbFormat(src.format);
  const destIsRgb = isRgbFormat(destFormat);

  if (srcIsRgb && destIsRgb) {
    convertRgbToRgb(src, dest, destFormat, srcX, srcY, width, height);
  } else if (!srcIsRgb && destIsRgb) {
    convertYuvToRgb(src, dest, destFormat, srcX, srcY, width, height, colorMatrix);
  } else if (srcIsRgb && !destIsRgb) {
    convertRgbToYuv(src, dest, destFormat, srcX, srcY, width, height, colorMatrix);
  } else {
    // YUV to YUV - convert via RGB using pooled buffer
    const rgbaSize = width * height * 4;
    const rgbaBuffer = acquireBuffer(rgbaSize);
    try {
      convertYuvToRgb(src, rgbaBuffer, 'RGBA', srcX, srcY, width, height, colorMatrix);

      const tempSrc: FrameBuffer = {
        data: rgbaBuffer,
        format: 'RGBA',
        width,
        height,
      };
      convertRgbToYuv(tempSrc, dest, destFormat, 0, 0, width, height, colorMatrix);
    } finally {
      // Return buffer to pool for reuse
      releaseBuffer(rgbaBuffer);
    }
  }
}
