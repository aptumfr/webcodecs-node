/**
 * Canvas Utilities for skia-canvas
 *
 * Raw buffer utilities for efficient pixel data handling.
 * Always uses toBuffer('raw') - never PNG or other encoded formats.
 */

import { Canvas } from 'skia-canvas';
import type { RawBufferOptions } from './types.js';

/**
 * Create a pixel buffer for image manipulation
 *
 * Uses Uint8ClampedArray which automatically clamps values to 0-255,
 * preventing overflow bugs in filters and pixel manipulation code.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns Uint8ClampedArray of size width * height * 4 (RGBA)
 *
 * @example
 * ```typescript
 * const pixels = createPixelBuffer(1920, 1080);
 * // Safe manipulation - values auto-clamped to 0-255
 * pixels[0] = 300; // Becomes 255
 * pixels[1] = -50; // Becomes 0
 * ```
 */
export function createPixelBuffer(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

/**
 * Create a pixel buffer initialized with a solid color
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param r - Red component (0-255)
 * @param g - Green component (0-255)
 * @param b - Blue component (0-255)
 * @param a - Alpha component (0-255, default 255)
 * @returns Uint8ClampedArray filled with the specified color
 */
export function createPixelBufferWithColor(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number = 255
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  }
  return pixels;
}

/**
 * Get raw RGBA pixel data from canvas (synchronous)
 * ALWAYS uses toBufferSync('raw') - never PNG or other encoded formats.
 *
 * @param canvas - The skia-canvas Canvas instance
 * @param options - Optional buffer format options
 * @returns Buffer containing raw RGBA pixel data
 */
export function getRawPixels(canvas: Canvas, options?: RawBufferOptions): Buffer {
  return (canvas as any).toBufferSync('raw', {
    colorType: options?.colorType ?? 'rgba',
  });
}

/**
 * Get raw RGBA pixel data from canvas (asynchronous)
 * ALWAYS uses toBuffer('raw') - never PNG or other encoded formats.
 *
 * @param canvas - The skia-canvas Canvas instance
 * @param options - Optional buffer format options
 * @returns Promise resolving to Buffer containing raw RGBA pixel data
 */
export async function getRawPixelsAsync(
  canvas: Canvas,
  options?: RawBufferOptions
): Promise<Buffer> {
  return (canvas as any).toBuffer('raw', {
    colorType: options?.colorType ?? 'rgba',
  });
}

/**
 * Reset canvas state for new frame
 *
 * Prevents Skia command history buildup which can cause memory
 * growth and performance degradation over time.
 *
 * @param ctx - The 2D rendering context
 */
export function resetCanvas(ctx: CanvasRenderingContext2D): void {
  // Use reset() if available (Canvas API), otherwise clearRect
  if (typeof (ctx as any).reset === 'function') {
    (ctx as any).reset();
  } else {
    const canvas = ctx.canvas;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

/**
 * Simple ImageData-like object for internal use
 */
export interface SimpleImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace?: string;
  colorType?: string;
}

/**
 * Convert Uint8Array/Buffer to ImageData-like object
 * Compatible with skia-canvas putImageData
 *
 * @param data - Raw pixel data (RGBA format)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns ImageData-like object
 */
export function pixelsToImageData(
  data: Uint8Array | Buffer,
  width: number,
  height: number
): SimpleImageData {
  const clampedArray = new Uint8ClampedArray(
    data.buffer,
    data.byteOffset,
    data.byteLength
  );
  return {
    data: clampedArray,
    width,
    height,
    colorSpace: 'srgb',
    colorType: 'rgba', // Required by skia-canvas
  };
}

/**
 * Draw raw RGBA pixels to canvas
 *
 * @param canvas - The skia-canvas Canvas instance
 * @param data - Raw pixel data (RGBA format)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 */
export function drawPixelsToCanvas(
  canvas: Canvas,
  data: Uint8Array | Buffer,
  width: number,
  height: number
): void {
  const ctx = canvas.getContext('2d') as any;
  const imageData = pixelsToImageData(data, width, height);
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Create a Uint8Array view of a Buffer without copying
 *
 * @param buffer - Node.js Buffer
 * @returns Uint8Array view of the same memory
 */
export function bufferToUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/**
 * Resize raw pixel data using canvas
 *
 * @param data - Source pixel data (RGBA format)
 * @param srcWidth - Source width
 * @param srcHeight - Source height
 * @param dstWidth - Destination width
 * @param dstHeight - Destination height
 * @param canvas - Optional canvas to reuse (for performance)
 * @returns Resized pixel data as Buffer
 */
export function resizePixels(
  data: Uint8Array | Buffer,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  canvas?: Canvas
): Buffer {
  // Create source canvas
  const srcCanvas = new Canvas(srcWidth, srcHeight);
  const srcCtx = srcCanvas.getContext('2d') as any;
  const srcImageData = pixelsToImageData(data, srcWidth, srcHeight);
  srcCtx.putImageData(srcImageData, 0, 0);

  // Create or reuse destination canvas
  const dstCanvas = canvas ?? new Canvas(dstWidth, dstHeight);
  if (dstCanvas.width !== dstWidth || dstCanvas.height !== dstHeight) {
    // Canvas dimensions don't match, need to create new one
    const newDst = new Canvas(dstWidth, dstHeight);
    const dstCtx = newDst.getContext('2d') as any;
    dstCtx.drawImage(srcCanvas, 0, 0, dstWidth, dstHeight);
    return getRawPixels(newDst);
  }

  const dstCtx = dstCanvas.getContext('2d') as any;
  resetCanvas(dstCtx);
  dstCtx.drawImage(srcCanvas, 0, 0, dstWidth, dstHeight);
  return getRawPixels(dstCanvas);
}
