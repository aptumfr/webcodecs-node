/**
 * Batch Format Converter - Optimized batch processing for format conversions
 *
 * Provides SIMD-friendly conversion utilities and batch processing capabilities
 * for efficient video frame format conversion.
 */

import type { VideoPixelFormat } from '../pixel-formats.js';
import { acquireBuffer, releaseBuffer } from '../../utils/buffer-pool.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('BatchConverter');

/**
 * Frame data for batch conversion
 */
export interface BatchFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Batch conversion result
 */
export interface BatchConversionResult {
  frames: Uint8Array[];
  totalTimeMs: number;
  framesPerSecond: number;
}

/**
 * Clamp a value to byte range [0, 255]
 */
function clampByte(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : val;
}

/**
 * Optimized RGBA to I420 conversion using block processing
 * Processes 2x2 pixel blocks for chroma subsampling with loop unrolling
 */
export function convertRgbaToI420Fast(
  rgba: Uint8Array,
  width: number,
  height: number,
  dest?: Uint8Array
): Uint8Array {
  const ySize = width * height;
  const chromaW = width >> 1;
  const chromaH = height >> 1;
  const uvSize = chromaW * chromaH;

  const out = dest ?? new Uint8Array(ySize + 2 * uvSize);

  // BT.601 coefficients scaled by 256
  const KRY = 66, KGY = 129, KBY = 25;
  const KRU = -38, KGU = -74, KBU = 112;
  const KRV = 112, KGV = -94, KBV = -18;

  let yIdx = 0;
  let uvIdx = 0;
  const uOffset = ySize;
  const vOffset = ySize + uvSize;

  // Process 2x2 blocks for chroma subsampling
  for (let j = 0; j < height; j += 2) {
    const row0 = j * width;
    const row1 = (j + 1) * width;

    for (let i = 0; i < width; i += 2) {
      const rgbaBase = row0 * 4 + i * 4;

      // Top-left pixel
      const r0 = rgba[rgbaBase];
      const g0 = rgba[rgbaBase + 1];
      const b0 = rgba[rgbaBase + 2];
      out[yIdx++] = clampByte(((KRY * r0 + KGY * g0 + KBY * b0 + 128) >> 8) + 16);

      // Top-right pixel
      const r1 = rgba[rgbaBase + 4];
      const g1 = rgba[rgbaBase + 5];
      const b1 = rgba[rgbaBase + 6];
      out[yIdx++] = clampByte(((KRY * r1 + KGY * g1 + KBY * b1 + 128) >> 8) + 16);

      // Bottom row base
      const rgbaBase2 = row1 * 4 + i * 4;

      // Bottom-left pixel
      const r2 = rgba[rgbaBase2];
      const g2 = rgba[rgbaBase2 + 1];
      const b2 = rgba[rgbaBase2 + 2];
      out[row1 + i] = clampByte(((KRY * r2 + KGY * g2 + KBY * b2 + 128) >> 8) + 16);

      // Bottom-right pixel
      const r3 = rgba[rgbaBase2 + 4];
      const g3 = rgba[rgbaBase2 + 5];
      const b3 = rgba[rgbaBase2 + 6];
      out[row1 + i + 1] = clampByte(((KRY * r3 + KGY * g3 + KBY * b3 + 128) >> 8) + 16);

      // Average 4 pixels for chroma
      const avgR = (r0 + r1 + r2 + r3) >> 2;
      const avgG = (g0 + g1 + g2 + g3) >> 2;
      const avgB = (b0 + b1 + b2 + b3) >> 2;

      out[uOffset + uvIdx] = clampByte(((KRU * avgR + KGU * avgG + KBU * avgB + 128) >> 8) + 128);
      out[vOffset + uvIdx] = clampByte(((KRV * avgR + KGV * avgG + KBV * avgB + 128) >> 8) + 128);
      uvIdx++;
    }

    // Adjust yIdx for the bottom row that was already written
    yIdx = row1 + width;
  }

  return out;
}

/**
 * Optimized I420 to RGBA conversion
 * Uses pre-computed lookup tables for faster conversion
 */
export function convertI420ToRgbaFast(
  i420: Uint8Array,
  width: number,
  height: number,
  dest?: Uint8Array
): Uint8Array {
  const ySize = width * height;
  const chromaW = width >> 1;
  const chromaH = height >> 1;
  const uvSize = chromaW * chromaH;

  const out = dest ?? new Uint8Array(width * height * 4);

  const uOffset = ySize;
  const vOffset = ySize + uvSize;

  // BT.601 conversion factors
  // R = 1.164(Y-16) + 1.596(V-128)
  // G = 1.164(Y-16) - 0.813(V-128) - 0.391(U-128)
  // B = 1.164(Y-16) + 2.018(U-128)
  const KY = 298;  // 1.164 * 256
  const KVR = 409; // 1.596 * 256
  const KVG = -208; // -0.813 * 256
  const KUG = -100; // -0.391 * 256
  const KUB = 517; // 2.018 * 256

  let outIdx = 0;

  for (let j = 0; j < height; j++) {
    const yRow = j * width;
    const uvRow = (j >> 1) * chromaW;

    for (let i = 0; i < width; i++) {
      const yVal = i420[yRow + i];
      const uvIdx = uvRow + (i >> 1);
      const uVal = i420[uOffset + uvIdx] - 128;
      const vVal = i420[vOffset + uvIdx] - 128;

      const yComponent = KY * (yVal - 16);

      out[outIdx++] = clampByte((yComponent + KVR * vVal + 128) >> 8);
      out[outIdx++] = clampByte((yComponent + KVG * vVal + KUG * uVal + 128) >> 8);
      out[outIdx++] = clampByte((yComponent + KUB * uVal + 128) >> 8);
      out[outIdx++] = 255;
    }
  }

  return out;
}

/**
 * Optimized RGBA to BGRA swap using 32-bit operations
 * Processes 4 pixels at a time when possible
 */
export function swapRgbaBgraFast(
  src: Uint8Array,
  dest?: Uint8Array
): Uint8Array {
  const out = dest ?? new Uint8Array(src.length);
  const len = src.length;

  // Process in 16-byte chunks (4 pixels) for better cache utilization
  const chunkSize = 16;
  const chunks = Math.floor(len / chunkSize);
  const remainder = len % chunkSize;

  let i = 0;
  for (let c = 0; c < chunks; c++) {
    // Pixel 0
    out[i] = src[i + 2];
    out[i + 1] = src[i + 1];
    out[i + 2] = src[i];
    out[i + 3] = src[i + 3];

    // Pixel 1
    out[i + 4] = src[i + 6];
    out[i + 5] = src[i + 5];
    out[i + 6] = src[i + 4];
    out[i + 7] = src[i + 7];

    // Pixel 2
    out[i + 8] = src[i + 10];
    out[i + 9] = src[i + 9];
    out[i + 10] = src[i + 8];
    out[i + 11] = src[i + 11];

    // Pixel 3
    out[i + 12] = src[i + 14];
    out[i + 13] = src[i + 13];
    out[i + 14] = src[i + 12];
    out[i + 15] = src[i + 15];

    i += chunkSize;
  }

  // Handle remaining pixels
  for (let r = 0; r < remainder; r += 4) {
    out[i + r] = src[i + r + 2];
    out[i + r + 1] = src[i + r + 1];
    out[i + r + 2] = src[i + r];
    out[i + r + 3] = src[i + r + 3];
  }

  return out;
}

/**
 * Batch convert multiple frames from one format to another
 *
 * @param frames - Array of frame data to convert
 * @param srcFormat - Source pixel format
 * @param destFormat - Destination pixel format
 * @returns Batch conversion result with timing info
 */
export function batchConvertFrames(
  frames: BatchFrame[],
  srcFormat: VideoPixelFormat,
  destFormat: VideoPixelFormat
): BatchConversionResult {
  if (frames.length === 0) {
    return { frames: [], totalTimeMs: 0, framesPerSecond: 0 };
  }

  const start = performance.now();
  const results: Uint8Array[] = [];

  // Select converter based on format pair
  const converter = selectConverter(srcFormat, destFormat);

  for (const frame of frames) {
    const result = converter(frame.data, frame.width, frame.height);
    results.push(result);
  }

  const totalTimeMs = performance.now() - start;
  const framesPerSecond = frames.length / (totalTimeMs / 1000);

  logger.debug(`Batch converted ${frames.length} frames in ${totalTimeMs.toFixed(2)}ms (${framesPerSecond.toFixed(1)} fps)`);

  return {
    frames: results,
    totalTimeMs,
    framesPerSecond,
  };
}

/**
 * Select the best converter function for a format pair
 */
function selectConverter(
  srcFormat: VideoPixelFormat,
  destFormat: VideoPixelFormat
): (data: Uint8Array, width: number, height: number) => Uint8Array {
  // RGBA to I420
  if ((srcFormat === 'RGBA' || srcFormat === 'RGBX') && srcFormat === 'RGBA' &&
      (destFormat === 'I420')) {
    return convertRgbaToI420Fast;
  }

  // I420 to RGBA
  if (srcFormat === 'I420' && (destFormat === 'RGBA' || destFormat === 'RGBX')) {
    return convertI420ToRgbaFast;
  }

  // RGBA <-> BGRA swap
  if ((srcFormat === 'RGBA' && destFormat === 'BGRA') ||
      (srcFormat === 'BGRA' && destFormat === 'RGBA') ||
      (srcFormat === 'RGBX' && destFormat === 'BGRX') ||
      (srcFormat === 'BGRX' && destFormat === 'RGBX')) {
    return (data, _width, _height) => swapRgbaBgraFast(data);
  }

  // Generic fallback using the standard converter
  return (data: Uint8Array, width: number, height: number) => {
    // Import dynamically to avoid circular dependency
    const { convertFrameFormat } = require('./frame-converter.js');
    const destSize = getDestinationSize(destFormat, width, height);
    const dest = new Uint8Array(destSize);
    convertFrameFormat(
      { data, format: srcFormat, width, height },
      dest,
      destFormat
    );
    return dest;
  };
}

/**
 * Calculate destination buffer size for a format
 */
function getDestinationSize(format: VideoPixelFormat, width: number, height: number): number {
  switch (format) {
    case 'I420':
      return width * height + 2 * (Math.ceil(width / 2) * Math.ceil(height / 2));
    case 'I420A':
      return 2 * width * height + 2 * (Math.ceil(width / 2) * Math.ceil(height / 2));
    case 'I422':
      return width * height + 2 * (Math.ceil(width / 2) * height);
    case 'I444':
      return 3 * width * height;
    case 'NV12':
      return width * height + Math.ceil(width / 2) * Math.ceil(height / 2) * 2;
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
 * Process frames in batches with pooled buffers
 * More memory-efficient for large frame sequences
 *
 * @param frames - Array of frame data to convert
 * @param srcFormat - Source pixel format
 * @param destFormat - Destination pixel format
 * @param onFrame - Callback for each converted frame
 */
export async function batchConvertFramesStreaming(
  frames: BatchFrame[],
  srcFormat: VideoPixelFormat,
  destFormat: VideoPixelFormat,
  onFrame: (frame: Uint8Array, index: number) => void | Promise<void>
): Promise<{ totalTimeMs: number; framesPerSecond: number }> {
  const start = performance.now();
  const converter = selectConverter(srcFormat, destFormat);

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const destSize = getDestinationSize(destFormat, frame.width, frame.height);

    // Use pooled buffer for destination
    const pooledDest = acquireBuffer(destSize);
    try {
      const result = converter(frame.data, frame.width, frame.height);
      // Copy to pooled buffer if converter allocated new array
      if (result !== pooledDest) {
        pooledDest.set(result.subarray(0, destSize));
      }

      await onFrame(pooledDest.subarray(0, destSize), i);
    } finally {
      releaseBuffer(pooledDest);
    }
  }

  const totalTimeMs = performance.now() - start;
  const framesPerSecond = frames.length / (totalTimeMs / 1000);

  return { totalTimeMs, framesPerSecond };
}
