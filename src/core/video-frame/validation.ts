/**
 * VideoFrame validation utilities
 */

import type { DOMRectInit } from '../../types/index.js';
import type { VideoPixelFormat } from '../../types/video.js';

/** Valid pixel formats per WebCodecs spec */
export const VALID_PIXEL_FORMATS: Set<VideoPixelFormat> = new Set([
  'I420', 'I420A', 'I422', 'I422A', 'I444', 'I444A', 'NV12',
  'RGBA', 'RGBX', 'BGRA', 'BGRX',
  'I420P10', 'I420AP10', 'I422P10', 'I422AP10', 'I444P10', 'I444AP10', 'P010',
  'I420P12', 'I420AP12', 'I422P12', 'I422AP12', 'I444P12', 'I444AP12',
]);

/**
 * Validate that a value is a finite positive number
 */
export function validateFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite positive number`);
  }
}

/**
 * Validate duration if provided (must be finite non-negative)
 */
export function validateDuration(duration: number | undefined | null): void {
  if (duration !== undefined && duration !== null) {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError('duration must be a finite non-negative number');
    }
  }
}

/**
 * Validate rotation value (must be 0, 90, 180, or 270)
 */
export function validateRotation(rotation: number | undefined): void {
  if (rotation !== undefined && rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    throw new TypeError('rotation must be 0, 90, 180, or 270');
  }
}

/**
 * Validate that dimensions are valid for the given pixel format's subsampling
 */
export function validateSubsamplingAlignment(
  format: VideoPixelFormat,
  width: number,
  height: number
): void {
  // YUV 4:2:0 formats require even dimensions
  if (format === 'I420' || format === 'I420A' || format === 'NV12' ||
      format === 'I420P10' || format === 'I420P12' || format === 'P010') {
    if (width % 2 !== 0 || height % 2 !== 0) {
      throw new TypeError(
        `${format} format requires even dimensions, got ${width}x${height}`
      );
    }
  }
  // YUV 4:2:2 formats require even width
  if (format === 'I422' || format === 'I422P10' || format === 'I422P12') {
    if (width % 2 !== 0) {
      throw new TypeError(
        `${format} format requires even width, got ${width}`
      );
    }
  }
}

/**
 * Validate visibleRect is within coded bounds
 */
export function validateVisibleRect(
  visibleRect: DOMRectInit | undefined,
  codedWidth: number,
  codedHeight: number
): void {
  if (!visibleRect) return;

  const x = visibleRect.x ?? 0;
  const y = visibleRect.y ?? 0;
  const width = visibleRect.width ?? codedWidth;
  const height = visibleRect.height ?? codedHeight;

  if (!Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new TypeError('visibleRect values must be finite numbers');
  }

  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new TypeError('visibleRect must have non-negative origin and positive dimensions');
  }

  if (x + width > codedWidth || y + height > codedHeight) {
    throw new TypeError(
      `visibleRect (${x},${y},${width},${height}) exceeds coded dimensions (${codedWidth}x${codedHeight})`
    );
  }
}
