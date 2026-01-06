/**
 * VideoFrame - Represents a frame of video data
 * https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame
 */

import type { BufferSource, PlaneLayout, NativeFrame } from '../types/index.js';
import { DOMException, DOMRectReadOnly, isNativeFrame } from '../types/index.js';
import { toUint8Array, copyToUint8Array } from '../utils/buffer.js';
import type { VideoColorSpaceInit } from '../formats/index.js';
import {
  getFrameAllocationSize,
  getPlaneCount,
  getPlaneInfo,
  isRgbFormat,
  VideoColorSpace,
} from '../formats/index.js';

import {
  convertFrameFormat,
  getPlaneOffset,
  type FrameBuffer,
} from '../formats/conversions/frame-converter.js';

// Import types from types/video.ts
import type {
  VideoPixelFormat,
  VideoFrameBufferInit,
  VideoFrameCopyToOptions,
  VideoFrameInit,
} from '../types/video.js';

// Import from video-frame submodule
import {
  VALID_PIXEL_FORMATS,
  validateFinitePositive,
  validateDuration,
  validateRotation,
  validateSubsamplingAlignment,
  validateVisibleRect,
} from './video-frame/validation.js';
import {
  isDetached,
  detachArrayBuffers,
  validateTransferList,
} from './video-frame/transfer.js';
import { composeOrientations, computeDefaultDisplayDimensions } from './video-frame/orientation.js';
import { getPlaneLayoutForSize } from './video-frame/layout.js';

// Re-export types for backwards compatibility
export type { VideoPixelFormat, VideoFrameBufferInit, VideoFrameCopyToOptions, VideoFrameInit };

/**
 * VideoFrameMetadata interface per W3C WebCodecs spec
 * https://w3c.github.io/webcodecs/video_frame_metadata_registry.html
 */
export interface VideoFrameMetadata {
  /** Frame rotation in degrees (0, 90, 180, 270) */
  rotation?: 0 | 90 | 180 | 270;
  /** Whether to flip the frame horizontally */
  flip?: boolean;
}

// Import type guards from utils
import {
  isImageDataLike,
  isCanvasLike,
  isVideoFrameLike,
  isCanvasImageSource,
  extractCanvasPixels,
  type ImageDataLike,
  type CanvasLike,
  type VideoFrameLike,
  type SkiaCanvasLike,
} from '../utils/type-guards.js';

export class VideoFrame {
  private _data: Uint8Array;
  private _closed = false;
  private _nativeFrame: NativeFrame | null = null;
  private _nativeCleanup: (() => void) | null = null;

  private _format: VideoPixelFormat;
  private _codedWidth: number;
  private _codedHeight: number;
  private _codedRect: DOMRectReadOnly;
  private _visibleRect: DOMRectReadOnly;
  private _displayWidth: number;
  private _displayHeight: number;
  private _duration: number | null;
  private _timestamp: number;
  private _colorSpace: VideoColorSpace;
  private _inputLayout: PlaneLayout[] | null = null; // Layout from init, if provided
  private _rotation: 0 | 90 | 180 | 270 = 0;
  private _flip: boolean = false;

  get format(): VideoPixelFormat | null { return this._closed ? null : this._format; }
  get codedWidth(): number { return this._closed ? 0 : this._codedWidth; }
  get codedHeight(): number { return this._closed ? 0 : this._codedHeight; }
  get codedRect(): DOMRectReadOnly | null { return this._closed ? null : this._codedRect; }
  get visibleRect(): DOMRectReadOnly | null { return this._closed ? null : this._visibleRect; }
  get displayWidth(): number { return this._closed ? 0 : this._displayWidth; }
  get displayHeight(): number { return this._closed ? 0 : this._displayHeight; }
  // timestamp, duration, colorSpace, rotation, flip are preserved after close per WebCodecs spec
  get duration(): number | null { return this._duration; }
  get timestamp(): number { return this._timestamp; }
  get colorSpace(): VideoColorSpace { return this._colorSpace; }
  /** Frame rotation in degrees (0, 90, 180, 270) - preserved after close */
  get rotation(): 0 | 90 | 180 | 270 { return this._rotation; }
  /** Whether frame is flipped horizontally - preserved after close */
  get flip(): boolean { return this._flip; }

  /**
   * Create a VideoFrame from raw pixel data or CanvasImageSource
   */
  constructor(data: BufferSource, init: VideoFrameBufferInit);
  constructor(image: unknown, init?: VideoFrameInit);
  constructor(dataOrImage: BufferSource | unknown, init?: VideoFrameBufferInit | VideoFrameInit) {
    // Special case: constructing from another VideoFrame without init
    if (isVideoFrameLike(dataOrImage)) {
      const sourceFrame = dataOrImage as VideoFrameLike;

      // Source frame must not be closed
      if (sourceFrame.format === null) {
        throw new DOMException('Source VideoFrame is closed', 'InvalidStateError');
      }

      // Init is optional when constructing from VideoFrame
      const frameInit = (init as VideoFrameInit) || {};

      // Copy data from source frame
      let pixelData: Uint8Array;
      if ((sourceFrame as any)._buffer instanceof Uint8Array) {
        pixelData = new Uint8Array((sourceFrame as any)._buffer);
      } else if ((sourceFrame as any)._rawData instanceof Uint8Array) {
        pixelData = new Uint8Array((sourceFrame as any)._rawData);
      } else if ((sourceFrame as any)._data instanceof Uint8Array) {
        pixelData = new Uint8Array((sourceFrame as any)._data);
      } else {
        // Try copyTo if available
        const size = sourceFrame.allocationSize ? sourceFrame.allocationSize() : sourceFrame.codedWidth * sourceFrame.codedHeight * 4;
        pixelData = new Uint8Array(size);
        if (sourceFrame.copyTo) {
          sourceFrame.copyTo(pixelData);
        }
      }

      this._data = pixelData;
      this._format = sourceFrame.format as VideoPixelFormat;
      this._codedWidth = sourceFrame.codedWidth;
      this._codedHeight = sourceFrame.codedHeight;
      // Inherit timestamp from source if not specified
      this._timestamp = frameInit.timestamp ?? sourceFrame.timestamp;
      this._duration = frameInit.duration ?? sourceFrame.duration ?? null;

      this._codedRect = new DOMRectReadOnly(0, 0, sourceFrame.codedWidth, sourceFrame.codedHeight);

      if (frameInit.visibleRect) {
        this._visibleRect = new DOMRectReadOnly(
          frameInit.visibleRect.x ?? 0,
          frameInit.visibleRect.y ?? 0,
          frameInit.visibleRect.width ?? sourceFrame.codedWidth,
          frameInit.visibleRect.height ?? sourceFrame.codedHeight
        );
      } else if (sourceFrame.visibleRect) {
        this._visibleRect = new DOMRectReadOnly(
          sourceFrame.visibleRect.x,
          sourceFrame.visibleRect.y,
          sourceFrame.visibleRect.width,
          sourceFrame.visibleRect.height
        );
      } else {
        this._visibleRect = new DOMRectReadOnly(0, 0, sourceFrame.codedWidth, sourceFrame.codedHeight);
      }

      this._colorSpace = new VideoColorSpace(
        this._getDefaultColorSpace(this._format, frameInit.colorSpace)
      );

      // Compose orientations: source orientation + init orientation
      // Get source orientation from getter (if it's our VideoFrame) or metadata
      let srcRotation: 0 | 90 | 180 | 270 = 0;
      let srcFlip = false;
      if (typeof (sourceFrame as any).rotation === 'number') {
        srcRotation = (sourceFrame as any).rotation;
      } else if ((sourceFrame as any).metadata) {
        const sourceMetadata = (sourceFrame as any).metadata();
        srcRotation = sourceMetadata?.rotation ?? 0;
        srcFlip = sourceMetadata?.flip ?? false;
      }
      if (typeof (sourceFrame as any).flip === 'boolean') {
        srcFlip = (sourceFrame as any).flip;
      }

      const initRotation = frameInit.rotation ?? 0;
      const initFlip = frameInit.flip ?? false;

      // Compose the orientations per WebCodecs spec
      const composed = composeOrientations(srcRotation, srcFlip, initRotation, initFlip);
      this._rotation = composed.rotation;
      this._flip = composed.flip;

      // Display dimensions: use explicit values if provided, otherwise compute from source
      // accounting for the composed orientation's effect on dimensions
      if (frameInit.displayWidth !== undefined && frameInit.displayHeight !== undefined) {
        this._displayWidth = frameInit.displayWidth;
        this._displayHeight = frameInit.displayHeight;
      } else {
        // Compute default display dimensions based on composed orientation
        const defaultDisplay = computeDefaultDisplayDimensions(
          this._visibleRect.width, this._visibleRect.height, this._rotation
        );
        this._displayWidth = frameInit.displayWidth ?? defaultDisplay.displayWidth;
        this._displayHeight = frameInit.displayHeight ?? defaultDisplay.displayHeight;
      }
      return;
    }

    // Validate init is provided for non-VideoFrame sources
    if (!init || typeof init !== 'object') {
      throw new TypeError('VideoFrame init is required');
    }

    // Check if it's raw pixel data (BufferSource) first
    if (this._isNativeFrame(dataOrImage)) {
      const bufferInit = init as VideoFrameBufferInit;

      if (!bufferInit.format) {
        throw new TypeError('format is required');
      }
      // Validate pixel format is known
      if (!VALID_PIXEL_FORMATS.has(bufferInit.format)) {
        throw new TypeError(`Unknown pixel format: ${bufferInit.format}`);
      }
      if (typeof bufferInit.codedWidth !== 'number') {
        throw new TypeError('codedWidth is required');
      }
      validateFinitePositive(bufferInit.codedWidth, 'codedWidth');
      if (typeof bufferInit.codedHeight !== 'number') {
        throw new TypeError('codedHeight is required');
      }
      validateFinitePositive(bufferInit.codedHeight, 'codedHeight');
      if (typeof bufferInit.timestamp !== 'number' || !Number.isFinite(bufferInit.timestamp)) {
        throw new TypeError('timestamp must be a finite number');
      }
      // Validate subsampling alignment
      validateSubsamplingAlignment(bufferInit.format, bufferInit.codedWidth, bufferInit.codedHeight);
      // Validate visibleRect bounds
      validateVisibleRect(bufferInit.visibleRect, bufferInit.codedWidth, bufferInit.codedHeight);
      // Validate displayWidth/displayHeight if provided
      if (bufferInit.displayWidth !== undefined) {
        validateFinitePositive(bufferInit.displayWidth, 'displayWidth');
      }
      if (bufferInit.displayHeight !== undefined) {
        validateFinitePositive(bufferInit.displayHeight, 'displayHeight');
      }
      // Validate duration if provided
      validateDuration(bufferInit.duration);
      // Validate rotation if provided
      validateRotation(bufferInit.rotation);

      this._nativeFrame = dataOrImage as NativeFrame;
      this._nativeCleanup = (init as { _nativeCleanup?: () => void })._nativeCleanup ?? null;
      this._data = new Uint8Array(0);

      this._format = bufferInit.format;
      this._codedWidth = bufferInit.codedWidth;
      this._codedHeight = bufferInit.codedHeight;
      this._timestamp = bufferInit.timestamp;
      this._duration = bufferInit.duration ?? null;

      this._codedRect = new DOMRectReadOnly(0, 0, bufferInit.codedWidth, bufferInit.codedHeight);

      if (bufferInit.visibleRect) {
        this._visibleRect = new DOMRectReadOnly(
          bufferInit.visibleRect.x ?? 0,
          bufferInit.visibleRect.y ?? 0,
          bufferInit.visibleRect.width ?? bufferInit.codedWidth,
          bufferInit.visibleRect.height ?? bufferInit.codedHeight
        );
      } else {
        this._visibleRect = new DOMRectReadOnly(0, 0, bufferInit.codedWidth, bufferInit.codedHeight);
      }

      // Set rotation/flip first as they affect default display dimensions
      this._rotation = bufferInit.rotation ?? 0;
      this._flip = bufferInit.flip ?? false;
      // Compute default display dimensions (swapped for 90/270 rotation)
      const defaultDisplay = computeDefaultDisplayDimensions(
        this._visibleRect.width, this._visibleRect.height, this._rotation
      );
      this._displayWidth = bufferInit.displayWidth ?? defaultDisplay.displayWidth;
      this._displayHeight = bufferInit.displayHeight ?? defaultDisplay.displayHeight;
      this._colorSpace = new VideoColorSpace(
        this._getDefaultColorSpace(bufferInit.format, bufferInit.colorSpace)
      );
    } else if (dataOrImage instanceof ArrayBuffer || ArrayBuffer.isView(dataOrImage)) {
      const data = dataOrImage as BufferSource;
      const bufferInit = init as VideoFrameBufferInit;

      // Validate required parameters for buffer init
      if (!bufferInit.format) {
        throw new TypeError('format is required');
      }
      // Validate pixel format is known
      if (!VALID_PIXEL_FORMATS.has(bufferInit.format)) {
        throw new TypeError(`Unknown pixel format: ${bufferInit.format}`);
      }
      if (typeof bufferInit.codedWidth !== 'number') {
        throw new TypeError('codedWidth is required');
      }
      validateFinitePositive(bufferInit.codedWidth, 'codedWidth');
      if (typeof bufferInit.codedHeight !== 'number') {
        throw new TypeError('codedHeight is required');
      }
      validateFinitePositive(bufferInit.codedHeight, 'codedHeight');
      if (typeof bufferInit.timestamp !== 'number' || !Number.isFinite(bufferInit.timestamp)) {
        throw new TypeError('timestamp must be a finite number');
      }
      // Validate subsampling alignment
      validateSubsamplingAlignment(bufferInit.format, bufferInit.codedWidth, bufferInit.codedHeight);
      // Validate visibleRect bounds
      validateVisibleRect(bufferInit.visibleRect, bufferInit.codedWidth, bufferInit.codedHeight);
      // Validate displayWidth/displayHeight if provided
      if (bufferInit.displayWidth !== undefined) {
        validateFinitePositive(bufferInit.displayWidth, 'displayWidth');
      }
      if (bufferInit.displayHeight !== undefined) {
        validateFinitePositive(bufferInit.displayHeight, 'displayHeight');
      }
      // Validate duration if provided
      validateDuration(bufferInit.duration);
      // Validate rotation if provided
      validateRotation(bufferInit.rotation);
      // Validate transfer list if provided (check for duplicates and detached buffers)
      validateTransferList(bufferInit.transfer);

      // Validate buffer size
      const expectedSize = getFrameAllocationSize(
        bufferInit.format,
        bufferInit.codedWidth,
        bufferInit.codedHeight
      );
      const actualSize = data instanceof ArrayBuffer ? data.byteLength : (data as ArrayBufferView).byteLength;
      if (actualSize < expectedSize) {
        throw new TypeError(
          `Buffer too small: expected at least ${expectedSize} bytes for ${bufferInit.format} ` +
          `${bufferInit.codedWidth}x${bufferInit.codedHeight}, got ${actualSize}`
        );
      }

      // Copy data to internal buffer (must happen before transfer detaches source)
      // Use copyToUint8Array when transfer is specified to ensure we don't hold a view
      // to a buffer that will be detached
      this._data = bufferInit.transfer && bufferInit.transfer.length > 0
        ? copyToUint8Array(data)
        : toUint8Array(data);

      // Detach transferred buffers after data has been copied
      detachArrayBuffers(bufferInit.transfer);

      this._format = bufferInit.format;
      this._codedWidth = bufferInit.codedWidth;
      this._codedHeight = bufferInit.codedHeight;
      this._timestamp = bufferInit.timestamp;
      this._duration = bufferInit.duration ?? null;

      this._codedRect = new DOMRectReadOnly(0, 0, bufferInit.codedWidth, bufferInit.codedHeight);

      if (bufferInit.visibleRect) {
        this._visibleRect = new DOMRectReadOnly(
          bufferInit.visibleRect.x ?? 0,
          bufferInit.visibleRect.y ?? 0,
          bufferInit.visibleRect.width ?? bufferInit.codedWidth,
          bufferInit.visibleRect.height ?? bufferInit.codedHeight
        );
      } else {
        this._visibleRect = new DOMRectReadOnly(0, 0, bufferInit.codedWidth, bufferInit.codedHeight);
      }

      // Set rotation/flip first as they affect default display dimensions
      this._rotation = bufferInit.rotation ?? 0;
      this._flip = bufferInit.flip ?? false;
      // Compute default display dimensions (swapped for 90/270 rotation)
      const defaultDisplay = computeDefaultDisplayDimensions(
        this._visibleRect.width, this._visibleRect.height, this._rotation
      );
      this._displayWidth = bufferInit.displayWidth ?? defaultDisplay.displayWidth;
      this._displayHeight = bufferInit.displayHeight ?? defaultDisplay.displayHeight;
      this._colorSpace = new VideoColorSpace(
        this._getDefaultColorSpace(bufferInit.format, bufferInit.colorSpace)
      );
      // Store input layout if provided (for non-standard memory layouts)
      this._inputLayout = bufferInit.layout ?? null;
    } else if (isCanvasImageSource(dataOrImage)) {
      const frameInit = init as VideoFrameInit;

      // WebCodecs spec §7.1 step 3: CanvasImageSource requires a finite timestamp
      if (typeof frameInit.timestamp !== 'number' || !Number.isFinite(frameInit.timestamp)) {
        throw new TypeError('timestamp is required and must be a finite number for CanvasImageSource');
      }

      const result = this._extractFromCanvasImageSource(dataOrImage, frameInit);

      // Validate canvas isn't empty
      if (result.width <= 0 || result.height <= 0) {
        throw new DOMException('CanvasImageSource has zero dimensions', 'InvalidStateError');
      }
      // Validate visibleRect bounds
      validateVisibleRect(frameInit.visibleRect, result.width, result.height);
      // Validate displayWidth/displayHeight if provided
      if (frameInit.displayWidth !== undefined) {
        validateFinitePositive(frameInit.displayWidth, 'displayWidth');
      }
      if (frameInit.displayHeight !== undefined) {
        validateFinitePositive(frameInit.displayHeight, 'displayHeight');
      }
      // Validate duration if provided
      validateDuration(frameInit.duration);
      // Validate rotation if provided
      validateRotation(frameInit.rotation);

      this._data = result.data;
      this._format = result.format;
      this._codedWidth = result.width;
      this._codedHeight = result.height;
      this._timestamp = frameInit.timestamp;
      this._duration = frameInit.duration ?? null;

      this._codedRect = new DOMRectReadOnly(0, 0, result.width, result.height);

      if (frameInit.visibleRect) {
        this._visibleRect = new DOMRectReadOnly(
          frameInit.visibleRect.x ?? 0,
          frameInit.visibleRect.y ?? 0,
          frameInit.visibleRect.width ?? result.width,
          frameInit.visibleRect.height ?? result.height
        );
      } else {
        this._visibleRect = new DOMRectReadOnly(0, 0, result.width, result.height);
      }

      // Set rotation/flip first as they affect default display dimensions
      this._rotation = frameInit.rotation ?? 0;
      this._flip = frameInit.flip ?? false;
      // Compute default display dimensions (swapped for 90/270 rotation)
      const defaultDisplay = computeDefaultDisplayDimensions(
        this._visibleRect.width, this._visibleRect.height, this._rotation
      );
      this._displayWidth = frameInit.displayWidth ?? defaultDisplay.displayWidth;
      this._displayHeight = frameInit.displayHeight ?? defaultDisplay.displayHeight;
      this._colorSpace = new VideoColorSpace(
        this._getDefaultColorSpace(result.format, frameInit.colorSpace)
      );
    } else {
      throw new TypeError('data must be an ArrayBuffer, ArrayBufferView, or CanvasImageSource');
    }
  }

  /**
   * Get default color space based on pixel format
   * RGB formats default to sRGB, YUV formats to BT.709
   */
  private _getDefaultColorSpace(
    format: VideoPixelFormat,
    init?: VideoColorSpaceInit
  ): VideoColorSpaceInit {
    // If user provided values, use them
    if (init && (init.primaries || init.transfer || init.matrix || init.fullRange !== undefined)) {
      return init;
    }

    // Apply defaults based on format
    if (isRgbFormat(format)) {
      // sRGB defaults for RGB formats
      return {
        primaries: 'bt709',
        transfer: 'iec61966-2-1', // sRGB transfer function
        matrix: 'rgb',
        fullRange: true,
      };
    }

    // For YUV formats, return user init (or undefined for null values)
    return init ?? {};
  }

  /**
   * Extract pixel data from various CanvasImageSource types
   */
  private _extractFromCanvasImageSource(
    source: unknown,
    init: VideoFrameInit
  ): { data: Uint8Array; width: number; height: number; format: VideoPixelFormat } {
    const discardAlpha = init.alpha === 'discard';

    // 1. VideoFrame-like objects
    if (isVideoFrameLike(source)) {
      const vf = source as VideoFrameLike;
      let pixelData: Uint8Array;

      if (vf._buffer instanceof Uint8Array) {
        pixelData = new Uint8Array(vf._buffer);
      } else if (vf._rawData instanceof Uint8Array) {
        pixelData = new Uint8Array(vf._rawData);
      } else if (vf._data instanceof Uint8Array) {
        pixelData = new Uint8Array(vf._data);
      } else {
        pixelData = new Uint8Array(vf.codedWidth * vf.codedHeight * 4);
      }

      if (discardAlpha && (vf.format === 'RGBA' || vf.format === 'BGRA')) {
        for (let i = 3; i < pixelData.length; i += 4) {
          pixelData[i] = 255;
        }
      }

      return {
        data: pixelData,
        width: vf.codedWidth,
        height: vf.codedHeight,
        format: vf.format as VideoPixelFormat,
      };
    }

    // 2. ImageData-like objects
    if (isImageDataLike(source)) {
      const imgData = source as ImageDataLike;
      let pixelData = new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength);
      pixelData = new Uint8Array(pixelData);

      if (discardAlpha) {
        for (let i = 3; i < pixelData.length; i += 4) {
          pixelData[i] = 255;
        }
      }

      return {
        data: pixelData,
        width: imgData.width,
        height: imgData.height,
        format: 'RGBA',
      };
    }

    // 3. Canvas-like objects (including skia-canvas)
    if (isCanvasLike(source)) {
      const canvas = source as CanvasLike | SkiaCanvasLike;
      const width = canvas.width;
      const height = canvas.height;

      // Use unified pixel extraction (handles skia-canvas, polyfills, and standard canvas)
      let pixelData = extractCanvasPixels(canvas);
      pixelData = new Uint8Array(pixelData); // Copy to avoid sharing

      if (discardAlpha) {
        for (let i = 3; i < pixelData.length; i += 4) {
          pixelData[i] = 255;
        }
      }

      return { data: pixelData, width, height, format: 'RGBA' };
    }

    // 4. Objects with raw data properties
    const obj = source as Record<string, unknown>;
    const width = (obj.width ?? obj.codedWidth ?? 0) as number;
    const height = (obj.height ?? obj.codedHeight ?? 0) as number;

    let pixelData: Uint8Array | null = null;

    if (obj._data instanceof Uint8Array || obj._data instanceof Uint8ClampedArray) {
      pixelData = new Uint8Array(obj._data as Uint8Array);
    } else if (obj._rawData instanceof Uint8Array) {
      pixelData = new Uint8Array(obj._rawData as Uint8Array);
    } else if (obj.data instanceof Uint8Array || obj.data instanceof Uint8ClampedArray) {
      pixelData = new Uint8Array(obj.data as Uint8Array);
    }

    if (pixelData) {
      if (discardAlpha) {
        for (let i = 3; i < pixelData.length; i += 4) {
          pixelData[i] = 255;
        }
      }
      return { data: pixelData, width, height, format: 'RGBA' };
    }

    return {
      data: new Uint8Array(width * height * 4),
      width,
      height,
      format: 'RGBA',
    };
  }

  /**
   * Returns the number of bytes required to hold the frame
   */
  allocationSize(options?: VideoFrameCopyToOptions): number {
    this._checkNotClosed();
    this._ensureDataLoaded();

    const format = options?.format ?? this._format;
    const rect = options?.rect;
    const width = rect?.width ?? this._visibleRect.width;
    const height = rect?.height ?? this._visibleRect.height;

    return getFrameAllocationSize(format, width, height);
  }

  /**
   * Returns metadata associated with this VideoFrame.
   * Per W3C WebCodecs spec: https://w3c.github.io/webcodecs/video_frame_metadata_registry.html
   */
  metadata(): VideoFrameMetadata {
    this._checkNotClosed();
    const result: VideoFrameMetadata = {};
    if (this._rotation !== 0) {
      result.rotation = this._rotation;
    }
    if (this._flip) {
      result.flip = this._flip;
    }
    return result;
  }

  /**
   * Returns the number of planes for this frame's format
   */
  get numberOfPlanes(): number {
    return this._closed ? 0 : getPlaneCount(this._format);
  }

  /**
   * Copies the frame data to the destination buffer
   */
  async copyTo(
    destination: BufferSource,
    options?: VideoFrameCopyToOptions
  ): Promise<PlaneLayout[]> {
    this._checkNotClosed();
    this._ensureDataLoaded();

    const destArray = toUint8Array(destination);

    const destFormat = options?.format ?? this._format;
    const rect = options?.rect;
    const layout = options?.layout;

    const srcX = Math.floor(rect?.x ?? this._visibleRect.x);
    const srcY = Math.floor(rect?.y ?? this._visibleRect.y);
    const srcW = Math.floor(rect?.width ?? this._visibleRect.width);
    const srcH = Math.floor(rect?.height ?? this._visibleRect.height);

    if (srcX < 0 || srcY < 0 || srcX + srcW > this._codedWidth || srcY + srcH > this._codedHeight) {
      throw new DOMException('Rect is out of bounds', 'ConstraintError');
    }

    // Validate layout if provided
    const numPlanes = getPlaneCount(destFormat);
    if (layout) {
      if (layout.length !== numPlanes) {
        throw new TypeError(`layout must have ${numPlanes} entries for format ${destFormat}, got ${layout.length}`);
      }
      // Validate that buffer is large enough for the provided layout
      for (let p = 0; p < numPlanes; p++) {
        const planeInfo = getPlaneInfo(destFormat, srcW, srcH, p);
        const planeEnd = layout[p].offset + (planeInfo.height - 1) * layout[p].stride + planeInfo.width * planeInfo.bytesPerPixel;
        if (planeEnd > destArray.byteLength) {
          throw new TypeError(`destination buffer too small for layout: plane ${p} needs ${planeEnd} bytes`);
        }
      }
    }

    const requiredSize = layout ? 0 : getFrameAllocationSize(destFormat, srcW, srcH);
    if (!layout && destArray.byteLength < requiredSize) {
      throw new TypeError(`destination buffer is too small (need ${requiredSize}, got ${destArray.byteLength})`);
    }

    // Fast path: no conversion, no clipping, no custom layout
    if (!layout && destFormat === this._format && srcX === 0 && srcY === 0 &&
        srcW === this._codedWidth && srcH === this._codedHeight) {
      destArray.set(this._data);
      return getPlaneLayoutForSize(srcW, srcH, destFormat);
    }

    // Get colorSpace for conversion (use options if provided, otherwise use frame's colorSpace)
    // Convert null values to undefined for proper VideoColorSpaceInit compatibility
    const colorSpace: VideoColorSpaceInit | undefined = options?.colorSpace ?? {
      primaries: this._colorSpace.primaries as VideoColorSpaceInit['primaries'],
      transfer: this._colorSpace.transfer as VideoColorSpaceInit['transfer'],
      matrix: this._colorSpace.matrix as VideoColorSpaceInit['matrix'],
      fullRange: this._colorSpace.fullRange ?? undefined,
    };

    // Copy with optional layout
    if (layout) {
      this._copyWithLayout(destArray, destFormat, srcX, srcY, srcW, srcH, layout, colorSpace);
      return layout;
    }

    this._copyWithConversion(destArray, destFormat, srcX, srcY, srcW, srcH, colorSpace);
    return getPlaneLayoutForSize(srcW, srcH, destFormat);
  }

  /**
   * Copy to destination with custom layout (offsets and strides)
   */
  private _copyWithLayout(
    dest: Uint8Array,
    destFormat: VideoPixelFormat,
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number,
    layout: PlaneLayout[],
    colorSpace?: VideoColorSpaceInit
  ): void {
    // First, convert to a temporary buffer if format conversion needed
    let srcData: Uint8Array;
    if (this._format === destFormat) {
      srcData = this._data;
    } else {
      // Convert to temp buffer with packed layout, then copy to dest with custom layout
      const tempSize = getFrameAllocationSize(destFormat, srcW, srcH);
      const tempBuffer = new Uint8Array(tempSize);
      this._copyWithConversion(tempBuffer, destFormat, srcX, srcY, srcW, srcH, colorSpace);
      srcData = tempBuffer;
      // Reset srcX/srcY since tempBuffer already has the clipped region
      srcX = 0;
      srcY = 0;
    }

    const numPlanes = getPlaneCount(destFormat);
    let srcOffset = 0;

    for (let p = 0; p < numPlanes; p++) {
      const planeInfo = getPlaneInfo(destFormat, srcW, srcH, p);
      const destOffset = layout[p].offset;
      const destStride = layout[p].stride;
      const srcStride = planeInfo.width * planeInfo.bytesPerPixel;

      // Copy row by row with custom stride
      for (let row = 0; row < planeInfo.height; row++) {
        const srcRowOffset = srcOffset + row * srcStride;
        const destRowOffset = destOffset + row * destStride;
        dest.set(srcData.subarray(srcRowOffset, srcRowOffset + srcStride), destRowOffset);
      }

      srcOffset += srcStride * planeInfo.height;
    }
  }

  private _copyWithConversion(
    dest: Uint8Array,
    destFormat: VideoPixelFormat,
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number,
    colorSpace?: VideoColorSpaceInit
  ): void {
    if (this._format === destFormat) {
      this._copyDirectWithClipping(dest, srcX, srcY, srcW, srcH);
      return;
    }

    // Use standalone conversion function
    const src: FrameBuffer = {
      data: this._data,
      format: this._format,
      width: this._codedWidth,
      height: this._codedHeight,
    };

    convertFrameFormat(src, dest, destFormat, srcX, srcY, srcW, srcH, colorSpace);
  }

  private _copyDirectWithClipping(
    dest: Uint8Array,
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number
  ): void {
    const numPlanes = getPlaneCount(this._format);
    let destOffset = 0;

    for (let p = 0; p < numPlanes; p++) {
      const planeInfo = getPlaneInfo(this._format, this._codedWidth, this._codedHeight, p);
      const srcPlaneInfo = getPlaneInfo(this._format, this._codedWidth, this._codedHeight, p);
      const dstPlaneInfo = getPlaneInfo(this._format, srcW, srcH, p);

      const subsampleX = this._codedWidth / srcPlaneInfo.width;
      const subsampleY = this._codedHeight / srcPlaneInfo.height;

      const planeX = Math.floor(srcX / subsampleX);
      const planeY = Math.floor(srcY / subsampleY);
      const planeW = dstPlaneInfo.width;
      const planeH = dstPlaneInfo.height;

      const srcPlaneOffset = getPlaneOffset(this._format, this._codedWidth, this._codedHeight, p);
      const srcStride = srcPlaneInfo.width * srcPlaneInfo.bytesPerPixel;
      const dstStride = planeW * planeInfo.bytesPerPixel;

      for (let row = 0; row < planeH; row++) {
        const srcRowOffset = srcPlaneOffset + (planeY + row) * srcStride + planeX * planeInfo.bytesPerPixel;
        dest.set(this._data.subarray(srcRowOffset, srcRowOffset + dstStride), destOffset);
        destOffset += dstStride;
      }
    }
  }

  /**
   * Creates a copy of this VideoFrame
   */
  clone(): VideoFrame {
    this._checkNotClosed();
    this._ensureDataLoaded();
    const dataCopy = new Uint8Array(this._data);
    // Convert null values from toJSON to undefined for VideoColorSpaceInit
    const colorSpaceJson = this._colorSpace.toJSON();
    const colorSpace: VideoColorSpaceInit = {
      primaries: (colorSpaceJson.primaries ?? undefined) as VideoColorSpaceInit['primaries'],
      transfer: (colorSpaceJson.transfer ?? undefined) as VideoColorSpaceInit['transfer'],
      matrix: (colorSpaceJson.matrix ?? undefined) as VideoColorSpaceInit['matrix'],
      fullRange: colorSpaceJson.fullRange ?? undefined,
    };
    return new VideoFrame(dataCopy, {
      format: this._format,
      codedWidth: this._codedWidth,
      codedHeight: this._codedHeight,
      timestamp: this._timestamp,
      duration: this._duration ?? undefined,
      displayWidth: this._displayWidth,
      displayHeight: this._displayHeight,
      visibleRect: this._visibleRect.toJSON(),
      colorSpace,
      rotation: this._rotation,
      flip: this._flip,
    });
  }

  /**
   * Releases the frame's resources
   */
  close(): void {
    this._closed = true;
    if (this._nativeCleanup) {
      try {
        this._nativeCleanup();
      } catch {
        // ignore cleanup failures
      }
    }
    this._nativeFrame = null;
    this._nativeCleanup = null;
    this._data = new Uint8Array(0);
  }

  /**
   * Get the raw data buffer (non-standard, for internal use)
   */
  get _buffer(): Uint8Array {
    this._checkNotClosed();
    this._ensureDataLoaded();
    return this._data;
  }

  get _native(): NativeFrame | null {
    return this._closed ? null : this._nativeFrame;
  }

  private _checkNotClosed(): void {
    if (this._closed) {
      throw new DOMException('VideoFrame is closed', 'InvalidStateError');
    }
  }

  private _isNativeFrame(obj: unknown): obj is NativeFrame {
    return isNativeFrame(obj);
  }

  private _ensureDataLoaded(): void {
    if (this._data.byteLength === 0 && this._nativeFrame) {
      try {
        const buffer = this._nativeFrame.toBuffer();
        this._data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      } catch {
        this._data = new Uint8Array(0);
      }
    }
  }
}
