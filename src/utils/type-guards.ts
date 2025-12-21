/**
 * Type guards for checking object types at runtime
 */

/**
 * Interface for ImageData-like objects
 */
export interface ImageDataLike {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * Interface for canvas-like objects with getContext
 */
export interface CanvasLike {
  width: number;
  height: number;
  getContext: (type: string, options?: unknown) => unknown;
  _getImageData?: () => Uint8ClampedArray;
}

/**
 * Interface for skia-canvas Canvas objects
 */
export interface SkiaCanvasLike {
  width: number;
  height: number;
  gpu: boolean;
  engine: {
    renderer: string;
    api?: string;
  };
  // Use any for context since skia-canvas has different types than DOM
  getContext: (type: '2d') => any;
  toBuffer: (format: string, options?: unknown) => Promise<Buffer>;
  toBufferSync: (format: string, options?: unknown) => Buffer;
}

/**
 * Interface for VideoFrame-like objects (including our polyfill)
 */
export interface VideoFrameLike {
  codedWidth: number;
  codedHeight: number;
  format: string | null;
  timestamp: number;
  duration?: number | null;
  displayWidth: number;
  displayHeight: number;
  visibleRect?: { x: number; y: number; width: number; height: number } | null;
  allocationSize?: (options?: unknown) => number;
  copyTo?: (dest: Uint8Array, options?: unknown) => void;
  _buffer?: Uint8Array;
  _rawData?: Uint8Array;
  _data?: Uint8Array;
}

/**
 * Check if object is ImageData-like (has data, width, height)
 */
export function isImageDataLike(obj: unknown): obj is ImageDataLike {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    (o.data instanceof Uint8ClampedArray || o.data instanceof Uint8Array) &&
    typeof o.width === 'number' &&
    typeof o.height === 'number'
  );
}

/**
 * Check if object is a skia-canvas Canvas
 */
export function isSkiaCanvas(obj: unknown): obj is SkiaCanvasLike {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.width === 'number' &&
    typeof o.height === 'number' &&
    typeof o.gpu === 'boolean' &&
    typeof o.getContext === 'function' &&
    typeof o.toBuffer === 'function' &&
    typeof o.toBufferSync === 'function' &&
    typeof o.engine === 'object'
  );
}

/**
 * Check if object is a canvas-like object with getContext
 * Includes both standard canvas and skia-canvas
 */
export function isCanvasLike(obj: unknown): obj is CanvasLike | SkiaCanvasLike {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;

  // Standard canvas check
  const isStandardCanvas =
    typeof o.width === 'number' &&
    typeof o.height === 'number' &&
    typeof o.getContext === 'function';

  return isStandardCanvas;
}

/**
 * Check if object is a VideoFrame-like object
 */
export function isVideoFrameLike(obj: unknown): obj is VideoFrameLike {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.codedWidth === 'number' &&
    typeof o.codedHeight === 'number' &&
    typeof o.format === 'string' &&
    typeof o.timestamp === 'number'
  );
}

/**
 * Check if an object is a CanvasImageSource-like object
 */
export function isCanvasImageSource(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    (typeof o.width === 'number' && typeof o.height === 'number') ||
    (typeof o.codedWidth === 'number' && typeof o.codedHeight === 'number') ||
    isImageDataLike(obj)
  );
}

/**
 * Extract raw pixel data from any canvas-like object
 * Returns RGBA Uint8Array
 *
 * @param canvas - Any canvas-like object (skia-canvas, polyfill, or standard)
 * @returns Raw RGBA pixel data as Uint8Array
 */
export function extractCanvasPixels(canvas: CanvasLike | SkiaCanvasLike): Uint8Array {
  // Try skia-canvas method first (most efficient)
  if ('toBufferSync' in canvas && typeof canvas.toBufferSync === 'function') {
    const buffer = (canvas as SkiaCanvasLike).toBufferSync('raw', { colorType: 'rgba' });
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  // Try polyfill method
  if ('_getImageData' in canvas && typeof canvas._getImageData === 'function') {
    const data = (canvas as CanvasLike)._getImageData!();
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  // Standard canvas 2D context
  const ctx = canvas.getContext('2d') as any;
  if (ctx && typeof ctx.getImageData === 'function') {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return new Uint8Array(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.byteLength
    );
  }

  // Fallback: empty buffer
  return new Uint8Array(canvas.width * canvas.height * 4);
}
