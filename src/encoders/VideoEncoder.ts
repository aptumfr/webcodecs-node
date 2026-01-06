/**
 * VideoEncoder - Encodes VideoFrames into EncodedVideoChunks
 * https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder
 */

import { WebCodecsEventTarget } from '../utils/event-target.js';
import { VideoFrame } from '../core/VideoFrame.js';
import { EncodedVideoChunk } from '../core/EncodedVideoChunk.js';
import type { EncodedVideoChunkType } from '../core/EncodedVideoChunk.js';
import { DOMException } from '../types/index.js';

type EventHandler = ((event: Event) => void) | null;
import type { VideoPixelFormat } from '../core/VideoFrame.js';
import { isVideoCodecBaseSupported } from '../capabilities/index.js';
import { pixelFormatToFFmpeg } from '../codec-utils/formats.js';
import { NodeAvVideoEncoder } from '../backends/node-av/video/NodeAvVideoEncoder.js';
import { encodingError, wrapAsWebCodecsError } from '../utils/errors.js';
import { validateVideoEncoderConfig, validateVideoCodec } from '../utils/codec-validation.js';
import { getCodecBase, parseCodec } from '../utils/codec-cache.js';
import type { VideoColorSpaceInit } from '../formats/color-space.js';

// Import from submodule
import {
  DEFAULT_FRAMERATE,
  DEFAULT_FLUSH_TIMEOUT,
  DEFAULT_MAX_QUEUE_SIZE,
} from './video/constants.js';
import { calculateMaxQueueSize } from './video/queue.js';
import type {
  CodecState,
  AvcEncoderConfig,
  HevcEncoderConfig,
  Av1EncoderConfig,
  VideoEncoderConfig,
  VideoEncoderInit,
  VideoEncoderOutputMetadata,
  VideoEncoderSupport,
  VideoEncoderEncodeOptions,
} from './video/types.js';

// Re-export types for backward compatibility
export type {
  CodecState,
  AvcEncoderConfig,
  HevcEncoderConfig,
  Av1EncoderConfig,
  VideoEncoderConfig,
  VideoEncoderInit,
  VideoEncoderOutputMetadata,
  VideoEncoderSupport,
  VideoEncoderEncodeOptions,
} from './video/types.js';

export class VideoEncoder extends WebCodecsEventTarget {
  private _state: CodecState = 'unconfigured';
  private _encodeQueueSize = 0;
  private _maxQueueSize = DEFAULT_MAX_QUEUE_SIZE;
  private _config: VideoEncoderConfig | null = null;
  private _outputCallback: (chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata) => void;
  private _errorCallback: (error: Error) => void;
  private _encoder: NodeAvVideoEncoder | null = null;
  private _frameCount = 0;
  private _keyFrameInterval = 30;
  // Map of timestamp -> frame info array for B-frame reordering support
  // Uses array to handle multiple frames with same timestamp (e.g., interlaced, alpha)
  // For AV1, timestamps are quantized to framerate before storing
  private _pendingFrames = new Map<number, Array<{ duration: number | null; keyFrame: boolean }>>();
  private _firstChunk = true;
  /** First frame's rotation - used to enforce consistent orientation */
  private _firstFrameRotation: 0 | 90 | 180 | 270 = 0;
  /** First frame's flip - used to enforce consistent orientation */
  private _firstFrameFlip = false;
  /** Whether we've seen the first frame (to track orientation) */
  private _hasFirstFrame = false;
  private _inputFormat: VideoPixelFormat | null = null;
  /** Input frame width (from first frame) - used for rescaling */
  private _inputWidth: number | null = null;
  /** Input frame height (from first frame) - used for rescaling */
  private _inputHeight: number | null = null;
  private _hardwarePreference: 'no-preference' | 'prefer-hardware' | 'prefer-software' = 'no-preference';
  private _ondequeue: EventHandler | null = null;
  private _flushPromise: Promise<void> | null = null;
  // AV1-specific: track if we need to quantize timestamps due to framerate-based timebase
  private _isAv1 = false;
  private _av1Framerate = DEFAULT_FRAMERATE;

  constructor(init: VideoEncoderInit) {
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
  get encodeQueueSize(): number { return this._encodeQueueSize; }

  /** Event handler called when encodeQueueSize decreases */
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

  private _safeOutputCallback(chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata): void {
    try {
      this._outputCallback(chunk, metadata);
    } catch (err) {
      this._safeErrorCallback(wrapAsWebCodecsError(err, 'EncodingError'));
    }
  }

  static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
    // Validate config - throws TypeError for invalid configs per spec
    validateVideoEncoderConfig(config);

    // Clone the config per WebCodecs spec
    const clonedConfig: VideoEncoderConfig = {
      codec: config.codec,
      width: config.width,
      height: config.height,
    };

    // Copy optional properties if present
    if (config.displayWidth !== undefined) clonedConfig.displayWidth = config.displayWidth;
    if (config.displayHeight !== undefined) clonedConfig.displayHeight = config.displayHeight;
    if (config.bitrate !== undefined) clonedConfig.bitrate = config.bitrate;
    if (config.framerate !== undefined) clonedConfig.framerate = config.framerate;
    if (config.hardwareAcceleration !== undefined) clonedConfig.hardwareAcceleration = config.hardwareAcceleration;
    if (config.alpha !== undefined) clonedConfig.alpha = config.alpha;
    if (config.scalabilityMode !== undefined) clonedConfig.scalabilityMode = config.scalabilityMode;
    if (config.bitrateMode !== undefined) clonedConfig.bitrateMode = config.bitrateMode;
    if (config.latencyMode !== undefined) clonedConfig.latencyMode = config.latencyMode;
    if (config.format !== undefined) clonedConfig.format = config.format;
    if (config.avc !== undefined) clonedConfig.avc = { ...config.avc };
    if (config.hevc !== undefined) clonedConfig.hevc = { ...config.hevc };
    if (config.av1 !== undefined) clonedConfig.av1 = { ...config.av1 };
    if (config.colorSpace !== undefined) clonedConfig.colorSpace = { ...config.colorSpace };
    if (config.maxQueueSize !== undefined) clonedConfig.maxQueueSize = config.maxQueueSize;
    if (config.contentHint !== undefined) clonedConfig.contentHint = config.contentHint;

    // Check for odd dimensions (required for YUV420)
    if (config.width % 2 !== 0 || config.height % 2 !== 0) {
      return { supported: false, config: clonedConfig };
    }

    // Check for unreasonably large dimensions
    if (config.width > 16384 || config.height > 16384) {
      return { supported: false, config: clonedConfig };
    }

    // Validate codec string format and check if supported
    const codecValidation = validateVideoCodec(config.codec);
    if (!codecValidation.supported) {
      return { supported: false, config: clonedConfig };
    }

    // Get normalized codec name for capability checks
    const parsed = parseCodec(config.codec);

    // Alpha channel support: only VP9 software encoding supports alpha
    // H.264, HEVC, AV1 do not support alpha encoding
    if (config.alpha === 'keep') {
      const supportsAlpha = parsed.name === 'vp9' &&
        config.hardwareAcceleration !== 'prefer-hardware';
      if (!supportsAlpha) {
        return { supported: false, config: clonedConfig };
      }
    }

    // Quantizer bitrate mode: only some codecs support CRF/CQ mode
    // H.264, HEVC, VP9, AV1 support quantizer mode
    // VP8 does not support quantizer mode (uses bitrate-based VBR only)
    if (config.bitrateMode === 'quantizer') {
      const supportsQuantizer = parsed.name === 'h264' || parsed.name === 'hevc' ||
        parsed.name === 'vp9' || parsed.name === 'av1';
      if (!supportsQuantizer) {
        return { supported: false, config: clonedConfig };
      }
    }

    return { supported: true, config: clonedConfig };
  }

  configure(config: VideoEncoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Encoder is closed', 'InvalidStateError');
    }

    if (!config || typeof config !== 'object') {
      throw new TypeError('config must be an object');
    }
    if (typeof config.codec !== 'string' || config.codec.length === 0) {
      throw new TypeError('codec must be a non-empty string');
    }
    if (typeof config.width !== 'number' || config.width <= 0 || !Number.isInteger(config.width)) {
      throw new TypeError('width must be a positive integer');
    }
    if (typeof config.height !== 'number' || config.height <= 0 || !Number.isInteger(config.height)) {
      throw new TypeError('height must be a positive integer');
    }

    // Validate even dimensions for hardware encoder compatibility
    // Many hardware encoders (NVENC, QuickSync, VideoToolbox) fail silently with odd dimensions
    if (config.width % 2 !== 0 || config.height % 2 !== 0) {
      const oddDims: string[] = [];
      if (config.width % 2 !== 0) oddDims.push(`width=${config.width}`);
      if (config.height % 2 !== 0) oddDims.push(`height=${config.height}`);
      throw new TypeError(
        `Dimensions must be even for video encoding (${oddDims.join(', ')}). ` +
        `Most video codecs require even dimensions for YUV420 chroma subsampling. ` +
        `Use ensureEvenDimensions() to auto-fix odd dimensions.`
      );
    }

    if (config.bitrate !== undefined && (typeof config.bitrate !== 'number' || config.bitrate <= 0)) {
      throw new TypeError('bitrate must be a positive number');
    }
    if (config.framerate !== undefined && (typeof config.framerate !== 'number' || config.framerate <= 0)) {
      throw new TypeError('framerate must be a positive number');
    }
    if (config.displayWidth !== undefined && (typeof config.displayWidth !== 'number' || config.displayWidth <= 0)) {
      throw new TypeError('displayWidth must be a positive number');
    }
    if (config.displayHeight !== undefined && (typeof config.displayHeight !== 'number' || config.displayHeight <= 0)) {
      throw new TypeError('displayHeight must be a positive number');
    }

    if (!isVideoCodecBaseSupported(config.codec)) {
      throw new DOMException(`Codec '${config.codec}' is not supported`, 'NotSupportedError');
    }

    if (this._encoder) {
      this._encoder.kill();
      this._encoder = null;
    }

    this._config = { ...config };
    this._state = 'configured';
    this._frameCount = 0;
    this._firstChunk = true;
    this._pendingFrames.clear();
    this._inputFormat = null;
    this._inputWidth = null;
    this._inputHeight = null;
    this._hardwarePreference = config.hardwareAcceleration ?? 'no-preference';
    this._maxQueueSize = config.maxQueueSize ?? calculateMaxQueueSize(config.width, config.height);

    // Detect AV1 for timestamp quantization - SVT-AV1 uses framerate-based timebase
    const codecBase = getCodecBase(config.codec);
    this._isAv1 = codecBase === 'av01' || codecBase === 'av1';
    this._av1Framerate = config.framerate ?? DEFAULT_FRAMERATE;
  }

  /**
   * Quantize timestamp to AV1 encoder timebase.
   * SVT-AV1 uses framerate-based timebase (1/framerate), so timestamps get quantized.
   * We must quantize before storing in _pendingFrames to match output timestamps.
   *
   * The math must match the backend exactly:
   * - Input (NodeAvVideoEncoder line 598): pts = Math.round(timestamp * framerate / 1_000_000)
   * - Output (NodeAvVideoEncoder line 704): timestamp = BigInt(pts * 1_000_000) / BigInt(framerate)
   *   which uses integer division (truncation, not rounding)
   */
  private _quantizeTimestamp(timestamp: number): number {
    if (!this._isAv1) {
      return timestamp;
    }
    // AV1 PTS = round(timestamp * framerate / 1_000_000) - matches backend input
    const pts = Math.round(timestamp * this._av1Framerate / 1_000_000);
    // Use truncation to match backend output (BigInt integer division truncates)
    return Math.trunc(pts * 1_000_000 / this._av1Framerate);
  }

  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    // Prevent encoding during flush to avoid race conditions
    if (this._flushPromise) {
      throw new DOMException(
        'Cannot encode while flush is pending. Wait for flush() to complete.',
        'InvalidStateError'
      );
    }

    if (!(frame instanceof VideoFrame)) {
      throw new TypeError('frame must be a VideoFrame');
    }

    if (!frame.format) {
      this._safeErrorCallback(encodingError('Cannot encode a closed VideoFrame'));
      return;
    }

    if (!this._encoder) {
      this._inputFormat = frame.format;
      // Track input dimensions for rescaling (use codedWidth/codedHeight as input size)
      this._inputWidth = frame.codedWidth;
      this._inputHeight = frame.codedHeight;
      const pixFormat = pixelFormatToFFmpeg(frame.format);
      this._startEncoder(pixFormat);
    }

    if (!this._encoder?.isHealthy) {
      this._safeErrorCallback(encodingError('Encoder process is not healthy'));
      return;
    }

    if (frame.format !== this._inputFormat) {
      this._safeErrorCallback(encodingError(
        `Frame format mismatch: expected ${this._inputFormat}, got ${frame.format}. All frames must use the same pixel format.`
      ));
      return;
    }

    // Validate frame dimensions consistency
    // Per WebCodecs spec, all frames must have the same dimensions
    if (frame.codedWidth !== this._inputWidth || frame.codedHeight !== this._inputHeight) {
      this._safeErrorCallback(new DOMException(
        `Frame dimension mismatch: expected ${this._inputWidth}x${this._inputHeight}, ` +
        `got ${frame.codedWidth}x${frame.codedHeight}. All frames must have consistent dimensions.`,
        'DataError'
      ));
      return;
    }

    // Track orientation metadata from first frame
    // Per WebCodecs spec, all frames must have consistent rotation/flip
    if (!this._hasFirstFrame) {
      this._firstFrameRotation = frame.rotation;
      this._firstFrameFlip = frame.flip;
      this._hasFirstFrame = true;
    } else {
      // Validate orientation consistency - WebCodecs requires all frames have same orientation
      if (frame.rotation !== this._firstFrameRotation || frame.flip !== this._firstFrameFlip) {
        this._safeErrorCallback(new DOMException(
          `Frame orientation mismatch: expected rotation=${this._firstFrameRotation}, flip=${this._firstFrameFlip}, ` +
          `got rotation=${frame.rotation}, flip=${frame.flip}. All frames must have consistent orientation.`,
          'DataError'
        ));
        return;
      }
    }

    // Check queue saturation to prevent unbounded memory growth
    if (this._encodeQueueSize >= this._maxQueueSize) {
      this._safeErrorCallback(new DOMException(
        `Encoder queue saturated (${this._maxQueueSize} frames pending). Wait for dequeue events before encoding more frames.`,
        'QuotaExceededError'
      ));
      return;
    }

    const keyFrame = options?.keyFrame ?? (this._frameCount % this._keyFrameInterval === 0);

    this._encodeQueueSize++;
    this._frameCount++;

    // Store frame info keyed by (possibly quantized) timestamp for B-frame reordering support
    // For AV1, timestamps are quantized to match encoder output timebase
    const mapKey = this._quantizeTimestamp(frame.timestamp);
    const existing = this._pendingFrames.get(mapKey);
    const frameInfo = { duration: frame.duration, keyFrame };
    if (existing) {
      existing.push(frameInfo);
    } else {
      this._pendingFrames.set(mapKey, [frameInfo]);
    }

    // Pass original timestamp to backend for proper PTS handling
    const nativeFrame = (frame as any)._native ?? null;
    const writeSuccess = nativeFrame
      ? this._encoder.writeFrame(nativeFrame, frame.timestamp)
      : this._encoder.write(frame._buffer, frame.timestamp);
    if (!writeSuccess) {
      this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
      // Remove the frame info we just added
      const arr = this._pendingFrames.get(mapKey);
      if (arr) {
        arr.pop(); // Remove the last added entry
        if (arr.length === 0) {
          this._pendingFrames.delete(mapKey);
        }
      }
      this._safeErrorCallback(encodingError('Failed to write frame data to encoder'));
    }
  }

  async flush(timeout: number = DEFAULT_FLUSH_TIMEOUT): Promise<void> {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    // If flush is already pending, return the existing promise
    if (this._flushPromise) {
      return this._flushPromise;
    }

    this._flushPromise = new Promise<void>((resolve, reject) => {
      if (!this._encoder) {
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
        this._encodeQueueSize = 0;
        this._pendingFrames.clear();
        this._encoder = null;
        this._inputFormat = null;
        this._inputWidth = null;
        this._inputHeight = null;
        this._frameCount = 0;
        this._firstChunk = true;
        this._hasFirstFrame = false;
        this._firstFrameRotation = 0;
        this._firstFrameFlip = false;
        this._flushPromise = null;
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

      this._encoder.end();
      this._encoder.once('close', doResolve);
      this._encoder.once('error', doReject);
    });

    return this._flushPromise;
  }

  reset(): void {
    if (this._state === 'closed') {
      throw new DOMException('Encoder is closed', 'InvalidStateError');
    }

    this._stopEncoder();
    this._state = 'unconfigured';
    this._config = null;
    this._encodeQueueSize = 0;
    this._pendingFrames.clear();
    this._frameCount = 0;
    this._firstChunk = true;
    this._inputFormat = null;
    this._inputWidth = null;
    this._inputHeight = null;
    this._flushPromise = null;
    this._hasFirstFrame = false;
    this._firstFrameRotation = 0;
    this._firstFrameFlip = false;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopEncoder();
    this._state = 'closed';
    this._config = null;
    this._encodeQueueSize = 0;
    this._pendingFrames.clear();
    this._flushPromise = null;
    this._inputWidth = null;
    this._inputHeight = null;
    this._hasFirstFrame = false;
    this._firstFrameRotation = 0;
    this._firstFrameFlip = false;
  }

  private _startEncoder(inputFormat?: string): void {
    if (!this._config) return;

    const pixFormat = inputFormat || 'yuv420p';
    this._encoder = new NodeAvVideoEncoder();

    // Resolve output format from codec-specific config or top-level config
    // Codec-specific configs take precedence (per WebCodecs spec)
    const codecBase = getCodecBase(this._config.codec);
    let outputFormat: 'annexb' | 'mp4' | undefined = this._config.format;

    if (codecBase === 'avc1' || codecBase === 'avc3') {
      const avcFormat = this._config.avc?.format;
      if (avcFormat === 'avc') outputFormat = 'mp4';
      else if (avcFormat === 'annexb') outputFormat = 'annexb';
    } else if (codecBase === 'hvc1' || codecBase === 'hev1') {
      const hevcFormat = this._config.hevc?.format;
      if (hevcFormat === 'hevc') outputFormat = 'mp4';
      else if (hevcFormat === 'annexb') outputFormat = 'annexb';
    }

    // Build AV1-specific config if applicable
    const av1Config = (codecBase === 'av01' && this._config.av1)
      ? { forceScreenContentTools: this._config.av1.forceScreenContentTools }
      : undefined;

    this._encoder.startEncoder({
      codec: this._config.codec,
      width: this._config.width,
      height: this._config.height,
      // Pass input dimensions for rescaling (if different from config width/height)
      inputWidth: this._inputWidth ?? this._config.width,
      inputHeight: this._inputHeight ?? this._config.height,
      inputPixelFormat: pixFormat,
      framerate: this._config.framerate,
      bitrate: this._config.bitrate,
      bitrateMode: this._config.bitrateMode,
      latencyMode: this._config.latencyMode,
      alpha: this._config.alpha,
      hardwareAcceleration: this._hardwarePreference,
      format: outputFormat,
      colorSpace: this._config.colorSpace,
      av1: av1Config,
    });

    this._encoder.on('encodedFrame', (frame: { data: Buffer; timestamp: number; keyFrame: boolean }) => {
      this._handleEncodedFrame(frame);
    });

    this._encoder.on('frameAccepted', () => {
      // Frame has started processing - decrement queue and fire dequeue event
      this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
      this._fireDequeueEvent();
    });

    this._encoder.on('error', (err: Error) => {
      this._safeErrorCallback(err);
    });
  }

  private _stopEncoder(): void {
    if (this._encoder) {
      this._encoder.kill();
      this._encoder = null;
    }
  }

  private _handleEncodedFrame(frame: { data: Buffer; timestamp: number; keyFrame: boolean; description?: Buffer }): void {
    if (!this._config) return;

    // Use the timestamp from the encoded packet (which preserves input timestamp through PTS)
    // This handles B-frame reordering correctly since we look up by timestamp, not FIFO
    const timestamp = frame.timestamp;
    const frameInfoArray = this._pendingFrames.get(timestamp);
    // Shift from array to get the first frame with this timestamp (FIFO within same timestamp)
    const frameInfo = frameInfoArray?.shift();
    const duration = frameInfo?.duration ?? undefined;

    // Clean up the map entry if array is now empty
    if (frameInfoArray && frameInfoArray.length === 0) {
      this._pendingFrames.delete(timestamp);
    }

    // Determine if this is a keyframe based solely on encoder output.
    // Per WebCodecs spec, chunk.type must reflect actual encoder output,
    // not the keyFrame request (which is just a hint to the encoder).
    const isKeyFrame = frame.keyFrame;

    const chunk = new EncodedVideoChunk({
      type: isKeyFrame ? 'key' : 'delta' as EncodedVideoChunkType,
      timestamp,
      duration,
      data: new Uint8Array(frame.data),
    });

    // Include decoder config with description on first chunk
    // Per WebCodecs spec, colorSpace should always be non-null with defaults
    const defaultColorSpace: VideoColorSpaceInit = {
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'bt709',
      fullRange: false,
    };
    const metadata: VideoEncoderOutputMetadata | undefined = this._firstChunk
      ? {
          decoderConfig: {
            codec: this._config.codec,
            codedWidth: this._config.width,
            codedHeight: this._config.height,
            description: frame.description ? new Uint8Array(frame.description) : undefined,
            // Include display dimensions if specified (for aspect ratio metadata)
            displayAspectWidth: this._config.displayWidth ?? this._config.width,
            displayAspectHeight: this._config.displayHeight ?? this._config.height,
            // Include colorSpace - use user-provided or default to BT.709
            colorSpace: this._config.colorSpace ?? defaultColorSpace,
            // Include orientation metadata from first encoded frame
            ...(this._firstFrameRotation !== 0 && { rotation: this._firstFrameRotation }),
            ...(this._firstFrameFlip && { flip: this._firstFrameFlip }),
          },
        }
      : undefined;

    this._firstChunk = false;
    this._safeOutputCallback(chunk, metadata);
  }

}
