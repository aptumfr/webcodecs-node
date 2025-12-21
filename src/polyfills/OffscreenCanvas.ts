/**
 * OffscreenCanvas Polyfill using skia-canvas
 *
 * Provides a Web-compatible OffscreenCanvas API for Node.js,
 * making it easy to port browser code to Node.js.
 *
 * skia-canvas provides:
 * - Metal acceleration on macOS
 * - Vulkan acceleration on Linux/Windows
 * - Automatic CPU fallback
 */

import { Canvas as SkiaCanvas } from 'skia-canvas';
import { VideoFrame } from '../core/VideoFrame.js';

/**
 * ImageData polyfill compatible with skia-canvas
 */
export class ImageDataPolyfill {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: string = 'srgb';
  readonly colorType: string = 'rgba'; // Required by skia-canvas

  constructor(width: number, height: number);
  constructor(data: Uint8ClampedArray, width: number, height?: number);
  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight: number,
    height?: number
  ) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / 4 / widthOrHeight;
    }
  }
}

/**
 * ImageBitmap-like object returned by transferToImageBitmap
 */
export interface ImageBitmapPolyfill {
  readonly width: number;
  readonly height: number;
  close(): void;
  readonly _data: Uint8ClampedArray;
}

/**
 * Blob polyfill for convertToBlob
 */
class BlobPolyfill {
  private _buffer: Buffer;
  readonly type: string;
  readonly size: number;

  constructor(buffer: Buffer, type: string) {
    this._buffer = buffer;
    this.type = type;
    this.size = buffer.length;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this._buffer.buffer.slice(
      this._buffer.byteOffset,
      this._buffer.byteOffset + this._buffer.byteLength
    ) as ArrayBuffer;
  }

  async text(): Promise<string> {
    return this._buffer.toString('utf-8');
  }

  stream(): ReadableStream<Uint8Array> {
    const buffer = this._buffer;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    });
  }

  slice(start?: number, end?: number, contentType?: string): BlobPolyfill {
    const sliced = this._buffer.slice(start, end);
    return new BlobPolyfill(sliced, contentType ?? this.type);
  }
}

/**
 * OffscreenCanvas Polyfill
 *
 * Provides a Web-compatible OffscreenCanvas API using skia-canvas.
 * This makes it easy to port browser canvas code to Node.js.
 *
 * @example
 * ```typescript
 * const canvas = new OffscreenCanvasPolyfill(1920, 1080);
 * const ctx = canvas.getContext('2d');
 * ctx.fillStyle = 'red';
 * ctx.fillRect(0, 0, 1920, 1080);
 *
 * // Create VideoFrame for encoding
 * const frame = new VideoFrame(canvas, { timestamp: 0 });
 * ```
 */
export class OffscreenCanvasPolyfill {
  private _canvas: SkiaCanvas;
  private _ctx: any | null = null;

  /**
   * Create a new OffscreenCanvas with the specified dimensions
   */
  constructor(width: number, height: number) {
    this._canvas = new SkiaCanvas(width, height);
  }

  /**
   * Get the width of the canvas
   */
  get width(): number {
    return this._canvas.width;
  }

  /**
   * Set the width of the canvas (creates new internal canvas)
   */
  set width(value: number) {
    const height = this._canvas.height;
    this._canvas = new SkiaCanvas(value, height);
    this._ctx = null;
  }

  /**
   * Get the height of the canvas
   */
  get height(): number {
    return this._canvas.height;
  }

  /**
   * Set the height of the canvas (creates new internal canvas)
   */
  set height(value: number) {
    const width = this._canvas.width;
    this._canvas = new SkiaCanvas(width, value);
    this._ctx = null;
  }

  /**
   * Get a 2D rendering context
   *
   * @param contextId - Must be '2d' (only 2D context is supported)
   * @param options - Context options (optional)
   * @returns CanvasRenderingContext2D or null if contextId is not '2d'
   */
  getContext(contextId: '2d', options?: any): any;
  getContext(contextId: string, options?: any): any | null {
    if (contextId === '2d') {
      if (!this._ctx) {
        this._ctx = this._canvas.getContext('2d');
      }
      return this._ctx;
    }
    // WebGL not supported
    return null;
  }

  /**
   * Convert canvas content to a Blob
   *
   * @param options - Optional encoding options
   * @returns Promise resolving to a Blob containing the image data
   */
  async convertToBlob(options?: {
    type?: string;
    quality?: number;
  }): Promise<BlobPolyfill> {
    const type = options?.type ?? 'image/png';
    const quality = options?.quality ?? 0.92;

    let format: string;
    let mimeType: string;

    if (type === 'image/jpeg' || type === 'image/jpg') {
      format = 'jpg';
      mimeType = 'image/jpeg';
    } else if (type === 'image/webp') {
      format = 'webp';
      mimeType = 'image/webp';
    } else {
      format = 'png';
      mimeType = 'image/png';
    }

    const buffer = await (this._canvas as any).toBuffer(format, {
      quality,
    });

    return new BlobPolyfill(buffer, mimeType);
  }

  /**
   * Transfer canvas content to an ImageBitmap
   *
   * Note: This creates a copy of the pixel data, as true zero-copy
   * transfer is not possible in Node.js the same way as in browsers.
   *
   * @returns ImageBitmap-like object with the canvas content
   */
  transferToImageBitmap(): ImageBitmapPolyfill {
    const pixels = this._getImageData();

    return {
      width: this._canvas.width,
      height: this._canvas.height,
      _data: pixels,
      close: () => {
        // No-op in Node.js
      },
    };
  }

  /**
   * Get raw RGBA pixel data from canvas
   * (Internal method for VideoFrame construction)
   */
  _getImageData(): Uint8ClampedArray {
    const buffer = (this._canvas as any).toBufferSync('raw', {
      colorType: 'rgba',
    });
    return new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  /**
   * Get the underlying skia-canvas Canvas
   * (Non-standard, for advanced use cases)
   */
  get _skiaCanvas(): SkiaCanvas {
    return this._canvas;
  }

  /**
   * Enable/disable GPU acceleration
   * (Non-standard, for performance tuning)
   */
  get gpu(): boolean {
    return (this._canvas as any).gpu;
  }

  set gpu(value: boolean) {
    (this._canvas as any).gpu = value;
  }
}

// Re-export core VideoFrame as VideoFramePolyfill for compatibility
export { VideoFrame as VideoFramePolyfill };

// Type alias for the context (skia-canvas provides full CanvasRenderingContext2D)
export type OffscreenCanvasRenderingContext2DPolyfill = any;

/**
 * Install the OffscreenCanvas polyfill globally
 *
 * This makes OffscreenCanvas available as a global, matching browser behavior.
 *
 * @example
 * ```typescript
 * import { installOffscreenCanvasPolyfill } from 'webcodecs-node';
 * installOffscreenCanvasPolyfill();
 *
 * // Now you can use OffscreenCanvas like in a browser
 * const canvas = new OffscreenCanvas(1920, 1080);
 * ```
 */
export function installOffscreenCanvasPolyfill(): void {
  const g = globalThis as Record<string, unknown>;

  if (typeof g.OffscreenCanvas === 'undefined') {
    g.OffscreenCanvas = OffscreenCanvasPolyfill;
  }

  if (typeof g.ImageData === 'undefined') {
    g.ImageData = ImageDataPolyfill;
  }

  if (typeof g.VideoFrame === 'undefined') {
    g.VideoFrame = VideoFrame;
  }
}
