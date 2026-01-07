/**
 * ImageDecoder - Decodes encoded image data to VideoFrames
 * https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder
 */

import { VideoFrame } from '../core/VideoFrame.js';
import type { VideoPixelFormat } from '../core/VideoFrame.js';
import { DOMException } from '../types/index.js';
import { createLogger } from '../utils/index.js';
import type { VideoColorSpaceInit } from '../formats/index.js';
import { NodeAvImageDecoder } from '../backends/node-av/image/NodeAvImageDecoder.js';
import { WebPImageDecoder } from '../backends/node-av/image/WebPImageDecoder.js';

// Import from submodule
import {
  ImageTrack,
  ImageTrackListClass,
  createImageTrackList,
  type ImageTrackList as ImageTrackListType,
} from './image/tracks.js';
import { parseExifOrientation, applyOrientation } from './image/orientation.js';
import { isReadableStream } from './image/stream.js';

const logger = createLogger('ImageDecoder');

export type ColorSpaceConversion = 'none' | 'default';
export type PremultiplyAlpha = 'none' | 'premultiply' | 'default';

// Re-export for backwards compatibility
export { ImageTrack };
export { ImageTrackListClass as ImageTrackList };

export interface ImageDecoderInit {
  type: string;
  data: ArrayBuffer | ArrayBufferView | ReadableStream<ArrayBufferView>;
  colorSpaceConversion?: ColorSpaceConversion;
  desiredWidth?: number;
  desiredHeight?: number;
  preferAnimation?: boolean;
  premultiplyAlpha?: PremultiplyAlpha;
  transfer?: ArrayBuffer[];
  /**
   * Preferred output pixel format.
   * - 'RGBA' (default): RGB with alpha channel, suitable for display
   * - 'I420': YUV 4:2:0 planar, efficient for video processing
   * - 'I420P10': 10-bit YUV 4:2:0, for HDR content (AVIF, etc.)
   * - Other formats as supported by the decoder
   *
   * Note: WebP images always output RGBA due to node-webpmux limitations.
   * JPEG/AVIF can output I420 directly for better performance.
   */
  preferredPixelFormat?: VideoPixelFormat;
}

export interface ImageDecodeOptions {
  frameIndex?: number;
  completeFramesOnly?: boolean;
}

export interface ImageDecodeResult {
  image: VideoFrame;
  complete: boolean;
}

export class ImageDecoder {
  private _type: string;
  private _data: Uint8Array | null = null;
  private _complete: boolean = false;
  private _completed: Promise<void>;
  private _resolveCompleted!: () => void;
  private _rejectCompleted!: (error: Error) => void;
  private _tracks: ImageTrackListType;
  private _closed: boolean = false;
  private _colorSpaceConversion: ColorSpaceConversion;
  private _premultiplyAlpha: PremultiplyAlpha;
  private _desiredWidth?: number;
  private _desiredHeight?: number;
  private _preferAnimation: boolean;
  private _visibleFrameCount: number = 0;
  private _visibleAnimated: boolean = false;
  private _visibleRepetitionCount: number = 1;
  private _preferredColorSpace: VideoColorSpaceInit | undefined;
  private _preferredPixelFormat: VideoPixelFormat;
  private _orientation: number = 1;
  private _orientationEvaluated = false;

  private _frames: Array<{
    data: Uint8Array;
    width: number;
    height: number;
    timestamp: number;
    duration: number;
    complete: boolean;
    colorSpace?: VideoColorSpaceInit;
    format: VideoPixelFormat;
  }> = [];
  private _framesParsed: boolean = false;
  private _repetitionCount: number | undefined = undefined;

  constructor(init: ImageDecoderInit) {
    if (!init || typeof init !== 'object') {
      throw new TypeError('init must be an object');
    }
    if (!init.type || typeof init.type !== 'string') {
      throw new TypeError('type is required and must be a string');
    }
    if (!init.data) {
      throw new TypeError('data is required');
    }

    this._type = init.type;
    this._colorSpaceConversion = init.colorSpaceConversion ?? 'default';
    this._premultiplyAlpha = init.premultiplyAlpha ?? 'default';
    this._desiredWidth = init.desiredWidth;
    this._desiredHeight = init.desiredHeight;
    this._preferAnimation = init.preferAnimation ?? true;
    this._preferredPixelFormat = init.preferredPixelFormat ?? 'RGBA';
    this._preferredColorSpace = this._colorSpaceConversion === 'default'
      ? { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true }
      : undefined;
    this._tracks = createImageTrackList();

    this._completed = new Promise((resolve, reject) => {
      this._resolveCompleted = resolve;
      this._rejectCompleted = reject;
    });

    // Validate transfer list if provided (check for duplicates and detached buffers)
    const transferList = init.transfer || [];
    const transferSet = new Set<ArrayBuffer>();
    for (const buffer of transferList) {
      if (!(buffer instanceof ArrayBuffer)) {
        throw new TypeError('transfer list must only contain ArrayBuffer objects');
      }
      if (transferSet.has(buffer)) {
        throw new DOMException('Duplicate ArrayBuffer in transfer list', 'DataCloneError');
      }
      // Use the 'detached' property if available (Node.js 20+)
      if ('detached' in buffer && (buffer as any).detached === true) {
        throw new DOMException('Cannot transfer a detached ArrayBuffer', 'DataCloneError');
      }
      // On Node <20, we cannot reliably detect detachment without false positives
      // on new ArrayBuffer(0). Assume NOT detached.
      transferSet.add(buffer);
    }

    if (init.data instanceof ArrayBuffer) {
      // Always copy the data - even when transferred, we need our own copy
      // before detaching the original (transfer means caller loses access, not zero-copy)
      this._data = new Uint8Array(init.data.slice(0));
      this._complete = true;
      this._detachTransferBuffers(transferList);
      this._initializeTracks();
    } else if (ArrayBuffer.isView(init.data)) {
      const view = init.data;
      // Always copy the data before potentially detaching the backing buffer
      this._data = new Uint8Array(view.byteLength);
      this._data.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      this._complete = true;
      this._detachTransferBuffers(transferList);
      this._initializeTracks();
    } else if (isReadableStream(init.data)) {
      this._detachTransferBuffers(transferList);
      this._readStream(init.data as ReadableStream<ArrayBufferView>);
    } else {
      throw new TypeError('data must be ArrayBuffer, ArrayBufferView, or ReadableStream');
    }
  }

  /**
   * Detach ArrayBuffers after data has been copied
   */
  private _detachTransferBuffers(buffers: ArrayBuffer[]): void {
    for (const buffer of buffers) {
      try {
        if (typeof (buffer as any).transfer === 'function') {
          (buffer as any).transfer();
        } else if (typeof structuredClone === 'function') {
          structuredClone(buffer, { transfer: [buffer] });
        }
      } catch {
        // Ignore errors during detachment
      }
    }
  }

  /**
   * Read data from a ReadableStream
   *
   * Note: Current implementation buffers the entire stream before decoding.
   * This is a limitation of the node-av backend which requires complete data
   * for image decoding. True progressive/streaming decode would require:
   * 1. Format-specific header parsing to determine image dimensions
   * 2. Progressive frame decoding as data arrives
   * 3. Updating track.frameCount as new frames are discovered
   *
   * For animated GIF streaming tests (WPT), this means frames won't be
   * available until the entire stream is received.
   */
  private async _readStream(stream: ReadableStream<ArrayBufferView>): Promise<void> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalReceived = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          chunks.push(chunk);
          totalReceived += chunk.length;
        }
      }

      // Concatenate all chunks
      this._data = new Uint8Array(totalReceived);
      let offset = 0;
      for (const chunk of chunks) {
        this._data.set(chunk, offset);
        offset += chunk.length;
      }

      this._complete = true;
      this._initializeTracks();
    } catch (error) {
      this._rejectCompleted(error as Error);
    }
  }

  private async _initializeTracks(): Promise<void> {
    try {
      this._evaluateOrientation();
      await this._parseImage();
      (this._tracks as any)._markReady();
      this._resolveCompleted();
    } catch (error) {
      this._rejectCompleted(error as Error);
    }
  }

  private async _parseImage(): Promise<void> {
    if (!this._data || this._framesParsed) return;

    if (!NodeAvImageDecoder.isTypeSupported(this._type)) {
      throw new DOMException(`Unsupported image type: ${this._type}`, 'NotSupportedError');
    }

    // Set default repetition count based on format
    // GIF loops forever by default, other animated formats may vary
    const type = this._type.toLowerCase();
    this._repetitionCount = type === 'image/gif' ? Infinity : undefined;

    await this._decodeAllFramesDirect();

    this._framesParsed = true;
    this._updateVisibleTrackInfo();

    const isAnimated = this._frames.length > 1;

    if (isAnimated) {
      // For animated images, create two tracks:
      // Track 0: Still (first frame only) - selected when preferAnimation=false
      // Track 1: Animated (all frames) - selected when preferAnimation=true
      const stillTrack = new ImageTrack({
        animated: false,
        frameCount: 1,
        repetitionCount: 0, // Still images have repetitionCount=0 per spec
        selected: !this._preferAnimation,
      });
      (this._tracks as any)._addTrack(stillTrack);

      const animatedTrack = new ImageTrack({
        animated: true,
        frameCount: this._visibleFrameCount,
        repetitionCount: this._visibleRepetitionCount,
        selected: this._preferAnimation,
      });
      (this._tracks as any)._addTrack(animatedTrack);
    } else {
      // Single frame image - just one track
      const track = new ImageTrack({
        animated: false,
        frameCount: 1,
        repetitionCount: 0,
        selected: true,
      });
      (this._tracks as any)._addTrack(track);
    }
  }

  private _frameTypeSupportsAlpha(): boolean {
    const type = this._type.toLowerCase();
    return ['image/png', 'image/apng', 'image/webp', 'image/gif', 'image/avif'].includes(type);
  }

  private _evaluateOrientation(): void {
    if (this._orientationEvaluated) {
      return;
    }
    this._orientationEvaluated = true;
    if (!this._data) {
      return;
    }

    const type = this._type.toLowerCase();
    if (type !== 'image/jpeg' && type !== 'image/jpg') {
      return;
    }

    const orientation = parseExifOrientation(this._data);
    if (orientation && orientation >= 1 && orientation <= 8) {
      this._orientation = orientation;
    }
  }

  private _shouldPremultiplyAlpha(): boolean {
    if (this._premultiplyAlpha === 'premultiply') {
      return true;
    }
    if (this._premultiplyAlpha === 'none') {
      return false;
    }
    return this._frameTypeSupportsAlpha();
  }

  private _processFrameData(data: Uint8Array): Uint8Array {
    if (!this._shouldPremultiplyAlpha()) {
      return data;
    }

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        continue;
      }
      const factor = alpha / 255;
      data[i] = Math.round(data[i] * factor);
      data[i + 1] = Math.round(data[i + 1] * factor);
      data[i + 2] = Math.round(data[i + 2] * factor);
    }

    return data;
  }

  private _updateVisibleTrackInfo(): void {
    const totalFrames = this._frames.length;
    this._visibleFrameCount = totalFrames;
    this._visibleAnimated = totalFrames > 1;

    // Per WebCodecs spec:
    // - Still images (single frame): repetitionCount = 0
    // - Animated images: repetitionCount = number of loops, Infinity = loop forever
    // File format convention: 0 in file = loop forever, converted to Infinity
    if (!this._visibleAnimated) {
      // Still image: repetitionCount is 0 per spec
      this._visibleRepetitionCount = 0;
    } else if (this._repetitionCount === 0) {
      // File says 0 = loop forever
      this._visibleRepetitionCount = Infinity;
    } else {
      // Use file value, or Infinity as default for animated
      this._visibleRepetitionCount = this._repetitionCount ?? Infinity;
    }
  }

  private async _decodeWithNodeAv(): Promise<void> {
    if (!this._data) return;

    logger.debug('Using node-av backend for image decoding');
    const nodeAvDecoder = new NodeAvImageDecoder({
      mimeType: this._type,
      data: this._data,
      desiredWidth: this._desiredWidth,
      desiredHeight: this._desiredHeight,
      colorSpace: this._preferredColorSpace,
      preferredFormat: this._preferredPixelFormat,
    });

    try {
      const decodedFrames = await nodeAvDecoder.decode();

      for (const frame of decodedFrames) {
        // Apply premultiplication if needed (only for RGBA)
        const processed = frame.format === 'RGBA'
          ? this._processFrameData(frame.data)
          : frame.data;
        // Apply orientation correction for JPEG (only for RGBA)
        const oriented = frame.format === 'RGBA'
          ? applyOrientation(processed, frame.width, frame.height, this._orientation)
          : { data: processed, width: frame.width, height: frame.height };

        this._frames.push({
          data: oriented.data,
          width: oriented.width,
          height: oriented.height,
          timestamp: frame.timestamp,
          duration: frame.duration,
          complete: frame.complete,
          colorSpace: frame.colorSpace,
          format: frame.format,
        });
      }
    } finally {
      nodeAvDecoder.close();
    }
  }

  private async _decodeWithWebP(): Promise<void> {
    if (!this._data) return;

    logger.debug('Using WebP decoder for WebP image');
    const webpDecoder = new WebPImageDecoder({
      data: this._data,
      desiredWidth: this._desiredWidth,
      desiredHeight: this._desiredHeight,
      colorSpace: this._preferredColorSpace,
    });

    try {
      const decodedFrames = await webpDecoder.decode();

      for (const frame of decodedFrames) {
        // Apply premultiplication if needed (WebP always outputs RGBA)
        const processed = this._processFrameData(frame.data);

        this._frames.push({
          data: processed,
          width: frame.width,
          height: frame.height,
          timestamp: frame.timestamp,
          duration: frame.duration,
          complete: frame.complete,
          colorSpace: frame.colorSpace,
          format: frame.format, // Always 'RGBA' for WebP
        });
      }
    } finally {
      webpDecoder.close();
    }
  }

  private async _decodeAllFramesDirect(): Promise<void> {
    if (!this._data) return;

    const type = this._type.toLowerCase();

    // Use dedicated WebP decoder for full animated WebP support
    if (type === 'image/webp') {
      await this._decodeWithWebP();
    } else {
      // Decode using node-av for other formats
      await this._decodeWithNodeAv();
    }

    if (this._frames.length === 0) {
      throw new Error('No frames decoded');
    }

    // Per WebCodecs spec, preferAnimation affects track selection when an image
    // has multiple representations. For animated images, we create two tracks:
    // - Track 0: Still image (first frame only)
    // - Track 1: Animated (all frames)
    // preferAnimation=true selects the animated track, false selects the still track.
    // This allows applications to choose between playing animation or showing a
    // static preview even for animated image formats.
  }

  get complete(): boolean { return this._complete; }
  get completed(): Promise<void> { return this._completed; }
  get tracks(): ImageTrackListType { return this._tracks; }
  get type(): string { return this._type; }

  static async isTypeSupported(type: string): Promise<boolean> {
    return NodeAvImageDecoder.isTypeSupported(type);
  }

  async decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult> {
    if (this._closed) {
      throw new DOMException('ImageDecoder is closed', 'InvalidStateError');
    }

    await this._completed;

    // Per WebCodecs spec, decode() requires a selected track
    const selectedTrack = this._tracks.selectedTrack;
    if (selectedTrack === null) {
      throw new DOMException('No track selected', 'InvalidStateError');
    }

    const frameIndex = options?.frameIndex ?? 0;
    const trackFrameCount = selectedTrack.frameCount;

    if (this._frames.length === 0) {
      throw new DOMException('No frames available', 'InvalidStateError');
    }

    // Validate frameIndex against selected track's frame count
    if (frameIndex < 0 || frameIndex >= trackFrameCount) {
      throw new DOMException(
        `Frame index ${frameIndex} out of range (0-${trackFrameCount - 1})`,
        'InvalidStateError'
      );
    }

    const frame = this._frames[frameIndex];
    const requireComplete = options?.completeFramesOnly ?? true;
    const frameComplete = frame.complete ?? true;

    if (requireComplete && !frameComplete) {
      throw new DOMException('Requested frame is not fully decoded', 'InvalidStateError');
    }

    const videoFrame = new VideoFrame(frame.data, {
      format: frame.format,
      codedWidth: frame.width,
      codedHeight: frame.height,
      timestamp: frame.timestamp,
      duration: frame.duration,
      colorSpace: frame.colorSpace,
    });

    return { image: videoFrame, complete: frameComplete };
  }

  reset(): void {
    if (this._closed) {
      throw new DOMException('ImageDecoder is closed', 'InvalidStateError');
    }

    if (!this._data) {
      return;
    }

    this._frames = [];
    this._framesParsed = false;
    this._repetitionCount = undefined;
    this._visibleFrameCount = 0;
    this._visibleAnimated = false;
    this._visibleRepetitionCount = 0;
    this._tracks = createImageTrackList();
    this._complete = false;
    this._completed = new Promise((resolve, reject) => {
      this._resolveCompleted = resolve;
      this._rejectCompleted = reject;
    });
    this._initializeTracks();
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._data = null;
    this._frames = [];
    this._visibleFrameCount = 0;
    this._visibleAnimated = false;
    this._visibleRepetitionCount = 1;
  }
}
