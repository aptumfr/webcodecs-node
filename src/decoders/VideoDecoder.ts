/**
 * VideoDecoder - Decodes encoded video chunks into VideoFrames
 * https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder
 */

import { WebCodecsEventTarget } from '../utils/event-target.js';
import { toUint8Array } from '../utils/buffer.js';
import { Buffer } from 'buffer';
import { VideoFrame } from '../core/VideoFrame.js';
import type { VideoPixelFormat } from '../core/VideoFrame.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import { NodeAvVideoDecoder } from '../node-av/NodeAvVideoDecoder.js';
import { DOMException, type NativeFrame, hasUnref } from '../types/index.js';

type EventHandler = ((event: Event) => void) | null;

import type { VideoColorSpaceInit } from '../formats/index.js';
import { isVideoCodecBaseSupported } from '../capabilities/index.js';
import { pixelFormatToFFmpeg } from '../codec-utils/formats.js';
import type { AvcConfig } from '../utils/avc.js';
import { convertAvccToAnnexB, parseAvcDecoderConfig } from '../utils/avc.js';
import type { HvccConfig } from '../utils/hevc.js';
import { convertHvccToAnnexB, parseHvccDecoderConfig } from '../utils/hevc.js';
import { getCodecBase, parseCodec } from '../utils/codec-cache.js';
import { encodingError, wrapAsWebCodecsError } from '../utils/errors.js';
import { validateVideoDecoderConfig, validateVideoCodec } from '../utils/codec-validation.js';

const SUPPORTED_OUTPUT_FORMATS: VideoPixelFormat[] = [
  'I420', 'I420A', 'I422', 'I444', 'NV12', 'RGBA', 'RGBX', 'BGRA', 'BGRX',
  // 10-bit formats
  'I420P10', 'I422P10', 'I444P10', 'P010'
];

export type CodecState = 'unconfigured' | 'configured' | 'closed';

export interface VideoDecoderConfig {
  codec: string;
  description?: ArrayBuffer | ArrayBufferView;
  codedWidth?: number;
  codedHeight?: number;
  displayAspectWidth?: number;
  displayAspectHeight?: number;
  colorSpace?: VideoColorSpaceInit;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  optimizeForLatency?: boolean;
  outputFormat?: VideoPixelFormat;
  /**
   * Maximum number of chunks that can be queued before decode() throws.
   * If not specified and dimensions are provided, automatically calculated based on resolution:
   * - 720p and below: 50 frames (~185MB for RGBA)
   * - 1080p: 30 frames (~250MB for RGBA)
   * - 4K: 10 frames (~330MB for RGBA)
   * - 8K: 4 frames (~530MB for RGBA)
   * If dimensions are not provided, defaults to 100.
   */
  maxQueueSize?: number;
}

export interface VideoDecoderInit {
  output: (frame: VideoFrame) => void;
  error: (error: Error) => void;
}

export interface VideoDecoderSupport {
  supported: boolean;
  config: VideoDecoderConfig;
}

const DEFAULT_FLUSH_TIMEOUT = 30000;
const DEFAULT_MAX_QUEUE_SIZE = 100; // Fallback if resolution unknown

/**
 * Calculate optimal queue size based on resolution to limit memory usage.
 * Target: ~250-500MB max memory for queued frames (RGBA format).
 */
function calculateMaxQueueSize(width: number, height: number): number {
  const pixels = width * height;
  const rgbaFrameBytes = pixels * 4;

  // Target max memory: ~300MB for queue
  const targetMemory = 300 * 1024 * 1024;
  const calculated = Math.floor(targetMemory / rgbaFrameBytes);

  // Clamp between 4 (minimum for smooth operation) and 100 (legacy max)
  return Math.max(4, Math.min(100, calculated));
}

export class VideoDecoder extends WebCodecsEventTarget {
  private _state: CodecState = 'unconfigured';
  private _decodeQueueSize = 0;
  private _maxQueueSize = DEFAULT_MAX_QUEUE_SIZE;
  private _config: VideoDecoderConfig | null = null;
  private _outputCallback: (frame: VideoFrame) => void;
  private _errorCallback: (error: Error) => void;
  private _decoder: NodeAvVideoDecoder | null = null;
  private _frameTimestamp = 0;
  private _frameDuration = 0;
  // Map of timestamp -> chunk info array for B-frame reordering support
  // Uses array to handle multiple chunks with same timestamp
  private _pendingChunks = new Map<number, Array<{ duration: number | null }>>();
  private _outputFormat: VideoPixelFormat = 'I420';
  private _avcConfig: AvcConfig | null = null;
  private _hevcConfig: HvccConfig | null = null;
  private _codecBase: string | null = null; // Cached codec base for decode() hot path
  private _hardwarePreference: 'no-preference' | 'prefer-hardware' | 'prefer-software' = 'no-preference';
  private _ondequeue: EventHandler | null = null;
  private _flushPromise: Promise<void> | null = null;

  constructor(init: VideoDecoderInit) {
    super();

    if (!init || typeof init.output !== 'function') {
      throw new TypeError('output callback is required');
    }
    if (typeof init.error !== 'function') {
      throw new TypeError('error callback is required');
    }

    this._outputCallback = init.output;
    this._errorCallback = init.error;
  }

  get state(): CodecState { return this._state; }
  get decodeQueueSize(): number { return this._decodeQueueSize; }

  /** Event handler called when decodeQueueSize decreases */
  get ondequeue(): EventHandler { return this._ondequeue; }
  set ondequeue(handler: EventHandler) { this._ondequeue = handler; }

  private _safeErrorCallback(error: Error): void {
    try {
      this._errorCallback(error);
    } catch {
      this.emit('callbackError', error);
    }
  }

  /** Fire the dequeue event (both EventTarget and ondequeue handler) */
  private _fireDequeueEvent(): void {
    queueMicrotask(() => {
      this.emit('dequeue');
      if (this._ondequeue) {
        try {
          this._ondequeue(new Event('dequeue'));
        } catch {
          // Ignore errors in user handler per spec
        }
      }
    });
  }

  private _safeOutputCallback(frame: VideoFrame): void {
    try {
      this._outputCallback(frame);
    } catch (err) {
      this._safeErrorCallback(wrapAsWebCodecsError(err, 'EncodingError'));
    }
  }

  static async isConfigSupported(config: VideoDecoderConfig): Promise<VideoDecoderSupport> {
    // Validate config - throws TypeError for invalid configs per spec
    validateVideoDecoderConfig(config);

    // Validate codec string format and check if supported
    const codecValidation = validateVideoCodec(config.codec);
    if (!codecValidation.supported) {
      return { supported: false, config };
    }

    // Check outputFormat compatibility
    if (config.outputFormat) {
      // Validate the requested output format is supported
      if (!SUPPORTED_OUTPUT_FORMATS.includes(config.outputFormat)) {
        return { supported: false, config };
      }

      // Some formats have codec-specific limitations
      const parsed = parseCodec(config.codec);

      // 10-bit output formats require codecs that support 10-bit decoding
      const is10BitFormat = config.outputFormat === 'I420P10' ||
        config.outputFormat === 'I422P10' ||
        config.outputFormat === 'I444P10' ||
        config.outputFormat === 'P010';

      if (is10BitFormat) {
        // Only HEVC, VP9, and AV1 support 10-bit content
        const supports10Bit = parsed.name === 'hevc' || parsed.name === 'vp9' || parsed.name === 'av1';
        if (!supports10Bit) {
          return { supported: false, config };
        }
      }
    }

    return { supported: true, config };
  }

  configure(config: VideoDecoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    if (!config || typeof config !== 'object') {
      throw new TypeError('config must be an object');
    }
    if (typeof config.codec !== 'string' || config.codec.length === 0) {
      throw new TypeError('codec must be a non-empty string');
    }

    if (config.codedWidth !== undefined && (typeof config.codedWidth !== 'number' || config.codedWidth <= 0)) {
      throw new TypeError('codedWidth must be a positive number');
    }
    if (config.codedHeight !== undefined && (typeof config.codedHeight !== 'number' || config.codedHeight <= 0)) {
      throw new TypeError('codedHeight must be a positive number');
    }

    if (!isVideoCodecBaseSupported(config.codec)) {
      throw new DOMException(`Codec '${config.codec}' is not supported`, 'NotSupportedError');
    }

    if (config.outputFormat !== undefined && !SUPPORTED_OUTPUT_FORMATS.includes(config.outputFormat)) {
      throw new TypeError(`Invalid outputFormat: ${config.outputFormat}`);
    }

    if (this._decoder) {
      this._decoder.kill();
      this._decoder = null;
    }

    this._config = { ...config };
    this._outputFormat = config.outputFormat ?? 'I420';
    this._state = 'configured';
    this._pendingChunks.clear();
    this._codecBase = getCodecBase(config.codec); // Cache for decode() hot path
    this._avcConfig = this._parseAvcDescription(config);
    this._hevcConfig = this._parseHevcDescription(config);
    this._hardwarePreference = config.hardwareAcceleration ?? 'no-preference';

    // Set max queue size: use config value, or calculate from dimensions, or use default
    if (config.maxQueueSize !== undefined) {
      this._maxQueueSize = config.maxQueueSize;
    } else if (config.codedWidth && config.codedHeight) {
      this._maxQueueSize = calculateMaxQueueSize(config.codedWidth, config.codedHeight);
    } else {
      this._maxQueueSize = DEFAULT_MAX_QUEUE_SIZE;
    }

    // Start decoder immediately if dimensions are known, otherwise defer to first decode()
    // WebCodecs spec allows size-less configs where dimensions come from the bitstream
    if (config.codedWidth && config.codedHeight) {
      this._startDecoder();
    }
    // If no dimensions, decoder will be started on first decode() call
  }

  decode(chunk: EncodedVideoChunk): void {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
    }

    // Prevent decoding during flush to avoid race conditions
    if (this._flushPromise) {
      throw new DOMException(
        'Cannot decode while flush is pending. Wait for flush() to complete.',
        'InvalidStateError'
      );
    }

    if (!(chunk instanceof EncodedVideoChunk)) {
      throw new TypeError('chunk must be an EncodedVideoChunk');
    }

    // Start decoder on first decode if not already started (size-less config case)
    if (!this._decoder) {
      this._startDecoder();
    }

    if (!this._decoder?.isHealthy) {
      this._safeErrorCallback(encodingError('Decoder process is not healthy'));
      return;
    }

    // Check queue saturation to prevent unbounded memory growth
    if (this._decodeQueueSize >= this._maxQueueSize) {
      this._safeErrorCallback(new DOMException(
        `Decoder queue saturated (${this._maxQueueSize} chunks pending). Wait for dequeue events before decoding more chunks.`,
        'QuotaExceededError'
      ));
      return;
    }

    this._decodeQueueSize++;

    // Store chunk info keyed by timestamp for B-frame reordering support
    // Append to array to handle multiple chunks with same timestamp
    const existing = this._pendingChunks.get(chunk.timestamp);
    const chunkInfo = { duration: chunk.duration };
    if (existing) {
      existing.push(chunkInfo);
    } else {
      this._pendingChunks.set(chunk.timestamp, [chunkInfo]);
    }

    let dataToWrite: Buffer | Uint8Array = chunk._buffer;

    // Use cached codec base for hot path (avoids getCodecBase() call per chunk)
    if (this._codecBase) {
      if (this._avcConfig && (this._codecBase === 'avc1' || this._codecBase === 'avc3')) {
        const includeParameterSets = chunk.type === 'key';
        dataToWrite = convertAvccToAnnexB(chunk._buffer, this._avcConfig, includeParameterSets);
      } else if (this._hevcConfig && (this._codecBase === 'hvc1' || this._codecBase === 'hev1')) {
        const includeParameterSets = chunk.type === 'key';
        dataToWrite = convertHvccToAnnexB(chunk._buffer, this._hevcConfig, includeParameterSets);
      }
    }

    const bufferData = Buffer.isBuffer(dataToWrite) ? dataToWrite : Buffer.from(dataToWrite);
    // Pass timestamp and duration to backend for proper PTS handling
    const writeSuccess = this._decoder.write(bufferData, chunk.timestamp, chunk.duration ?? undefined);

    if (!writeSuccess) {
      this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
      // Remove the chunk info we just added
      const arr = this._pendingChunks.get(chunk.timestamp);
      if (arr) {
        arr.pop(); // Remove the last added entry
        if (arr.length === 0) {
          this._pendingChunks.delete(chunk.timestamp);
        }
      }
      this._safeErrorCallback(encodingError('Failed to write chunk data to decoder'));
    }
  }

  async flush(timeout: number = DEFAULT_FLUSH_TIMEOUT): Promise<void> {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
    }

    // If flush is already pending, return the existing promise
    if (this._flushPromise) {
      return this._flushPromise;
    }

    this._flushPromise = new Promise<void>((resolve, reject) => {
      if (!this._decoder) {
        resolve();
        return;
      }

      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const doResolve = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this._decodeQueueSize = 0;
        this._pendingChunks.clear();
        this._decoder = null;
        this._flushPromise = null;
        if (this._config?.codedWidth && this._config?.codedHeight) {
          this._startDecoder();
        }
        resolve();
      };

      const doReject = (err: Error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this._flushPromise = null;
        reject(err);
      };

      timeoutId = setTimeout(() => {
        doReject(new DOMException('Flush operation timed out', 'TimeoutError'));
      }, timeout);

      this._decoder.end();
      this._decoder.once('close', doResolve);
      this._decoder.once('error', doReject);
    });

    return this._flushPromise;
  }

  reset(): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    this._stopDecoder();
    this._state = 'unconfigured';
    this._config = null;
    this._decodeQueueSize = 0;
    this._pendingChunks.clear();
    this._avcConfig = null;
    this._hevcConfig = null;
    this._flushPromise = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopDecoder();
    this._state = 'closed';
    this._config = null;
    this._decodeQueueSize = 0;
    this._pendingChunks.clear();
    this._avcConfig = null;
    this._hevcConfig = null;
    this._flushPromise = null;
  }

  private _startDecoder(): void {
    // Allow decoder to start even without dimensions - FFmpeg can parse them from the stream
    // This supports the WebCodecs pattern of configuring without dimensions
    if (!this._config) return;

    const pixFmt = pixelFormatToFFmpeg(this._outputFormat);

    // Don't pass HVCC/AVCC description to backend when we convert to Annex B
    // because VPS/SPS/PPS are already included in the converted keyframe data.
    // Passing HVCC extradata makes FFmpeg expect length-prefixed packets.
    const shouldPassDescription = !this._avcConfig && !this._hevcConfig;
    const description = shouldPassDescription ? this._getDescriptionBuffer() : null;

    this._decoder = new NodeAvVideoDecoder();

    // Pass 0 for dimensions if not configured - FFmpeg will parse from stream/extradata
    this._decoder.startDecoder({
      codec: this._config.codec,
      width: this._config.codedWidth ?? 0,
      height: this._config.codedHeight ?? 0,
      framerate: this._config.optimizeForLatency ? 60 : 30,
      outputPixelFormat: pixFmt,
      description: description ?? undefined,
      hardwareAcceleration: this._hardwarePreference,
    });

    this._decoder.on('frame', (data: { buffer?: Buffer; nativeFrame?: NativeFrame; timestamp: number }) => {
      this._handleDecodedFrame(data);
    });

    this._decoder.on('chunkAccepted', () => {
      // Chunk has started processing - decrement queue and fire dequeue event
      this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
      this._fireDequeueEvent();
    });

    this._decoder.on('error', (err: Error) => {
      this._safeErrorCallback(err);
    });
  }

  private _stopDecoder(): void {
    if (this._decoder) {
      this._decoder.kill();
      this._decoder = null;
    }
  }

  private _parseAvcDescription(config: VideoDecoderConfig): AvcConfig | null {
    if (!config.description) {
      return null;
    }

    const codecBase = getCodecBase(config.codec);
    if (codecBase !== 'avc1' && codecBase !== 'avc3') {
      return null;
    }

    try {
      const bytes = toUint8Array(config.description);
      const copy = new Uint8Array(bytes);
      return parseAvcDecoderConfig(copy);
    } catch {
      return null;
    }
  }

  private _parseHevcDescription(config: VideoDecoderConfig): HvccConfig | null {
    if (!config.description) {
      return null;
    }

    const codecBase = getCodecBase(config.codec);
    if (codecBase !== 'hvc1' && codecBase !== 'hev1') {
      return null;
    }

    try {
      const bytes = toUint8Array(config.description);
      const copy = new Uint8Array(bytes);
      return parseHvccDecoderConfig(copy);
    } catch {
      return null;
    }
  }

  private _getDescriptionBuffer(): Uint8Array | null {
    if (!this._config?.description) {
      return null;
    }

    try {
      return toUint8Array(this._config.description);
    } catch {
      return null;
    }
  }

  private _handleDecodedFrame(data: { buffer?: Buffer; nativeFrame?: NativeFrame; timestamp: number }): void {
    if (!this._config) return;

    // Use the timestamp from the decoded frame (which preserves input timestamp through PTS)
    // This handles B-frame reordering correctly since we look up by timestamp, not FIFO
    const timestamp = data.timestamp;
    const chunkInfoArray = this._pendingChunks.get(timestamp);
    // Shift from array to get the first chunk with this timestamp (FIFO within same timestamp)
    const chunkInfo = chunkInfoArray?.shift();
    const duration = chunkInfo?.duration ?? this._frameDuration;

    // Clean up the map entry if array is now empty
    if (chunkInfoArray && chunkInfoArray.length === 0) {
      this._pendingChunks.delete(timestamp);
    }

    const isNative = data.nativeFrame !== undefined;

    // For native frames, extract dimensions from the frame itself for size-less configs
    // For buffer frames, we need config dimensions (or the frame would be malformed).
    let codedWidth = this._config.codedWidth;
    let codedHeight = this._config.codedHeight;

    if (isNative) {
      // Extract dimensions from native frame (node-av Frame has width/height properties)
      const nativeWidth = (data.nativeFrame as any).width;
      const nativeHeight = (data.nativeFrame as any).height;
      if (nativeWidth > 0 && nativeHeight > 0) {
        codedWidth = nativeWidth;
        codedHeight = nativeHeight;
        // Update config for subsequent frames if dimensions were missing
        if (!this._config.codedWidth || !this._config.codedHeight) {
          this._config = { ...this._config, codedWidth, codedHeight };
          // Update max queue size now that we know dimensions
          this._maxQueueSize = this._config.maxQueueSize ?? calculateMaxQueueSize(codedWidth!, codedHeight!);
        }
      }
    }

    if (!isNative && (!codedWidth || !codedHeight)) {
      this._safeErrorCallback(
        new DOMException('Cannot create VideoFrame from buffer without configured dimensions', 'InvalidStateError')
      );
      return;
    }

    // Map displayAspectWidth/Height from config to displayWidth/Height for VideoFrame
    const displayWidth = this._config.displayAspectWidth;
    const displayHeight = this._config.displayAspectHeight;

    const frame = isNative
      ? new VideoFrame(data.nativeFrame!, {
        format: this._outputFormat,
        codedWidth: codedWidth!,
        codedHeight: codedHeight!,
        displayWidth,
        displayHeight,
        timestamp,
        duration: duration ?? undefined,
        colorSpace: this._config.colorSpace,
        _nativeCleanup: () => {
          try {
            const nf = data.nativeFrame;
            if (nf && hasUnref(nf)) {
              nf.unref();
            }
          } catch {
            // ignore cleanup errors
          }
        },
      } as { format: VideoPixelFormat; codedWidth: number; codedHeight: number; displayWidth?: number; displayHeight?: number; timestamp: number; duration?: number; colorSpace?: VideoColorSpaceInit; _nativeCleanup?: () => void })
      : new VideoFrame(data.buffer!, {
        format: this._outputFormat,
        codedWidth: this._config.codedWidth!,
        codedHeight: this._config.codedHeight!,
        displayWidth,
        displayHeight,
        timestamp,
        duration: duration ?? undefined,
        colorSpace: this._config.colorSpace,
      });

    this._safeOutputCallback(frame);
  }
}
