/**
 * AudioDecoder - Decodes EncodedAudioChunks into AudioData
 * https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder
 */

import { WebCodecsEventTarget } from '../utils/event-target.js';
import { toUint8Array } from '../utils/buffer.js';
import { validateNonEmptyString, validatePositiveInteger, validateRequired } from '../utils/validation.js';
import { AudioData } from '../core/AudioData.js';
import type { AudioSampleFormat } from '../core/AudioData.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { DOMException, type NativeFrame, hasUnref } from '../types/index.js';

type EventHandler = ((event: Event) => void) | null;

import {
  AUDIO_DECODER_CODEC_MAP,
  AUDIO_OUTPUT_FORMAT_MAP,
} from '../codec-utils/audio-codecs.js';
import type { AacConfig } from '../utils/aac.js';
import { parseAudioSpecificConfig } from '../utils/aac.js';
import { NodeAvAudioDecoder } from '../node-av/NodeAvAudioDecoder.js';
import { getCodecBase } from '../utils/codec-cache.js';
import { encodingError, wrapAsWebCodecsError } from '../utils/errors.js';

// Import from submodule
import { DEFAULT_FLUSH_TIMEOUT, MAX_QUEUE_SIZE } from './audio/constants.js';
import type { CodecState, AudioDecoderConfig, AudioDecoderInit, AudioDecoderSupport } from './audio/types.js';

// Re-export types for backward compatibility
export type { CodecState, AudioDecoderConfig, AudioDecoderInit, AudioDecoderSupport } from './audio/types.js';

export class AudioDecoder extends WebCodecsEventTarget {
  private _state: CodecState = 'unconfigured';
  private _decodeQueueSize = 0;
  private _config: AudioDecoderConfig | null = null;
  private _outputCallback: (data: AudioData) => void;
  private _errorCallback: (error: Error) => void;
  private _decoder: NodeAvAudioDecoder | null = null;
  private _frameIndex = 0;
  private _outputFormat: AudioSampleFormat = 'f32';
  private _aacConfig: AacConfig | null = null;
  private _ondequeue: EventHandler | null = null;
  private _flushPromise: Promise<void> | null = null;

  constructor(init: AudioDecoderInit) {
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

  private _safeOutputCallback(data: AudioData): void {
    try {
      this._outputCallback(data);
    } catch (err) {
      this._safeErrorCallback(wrapAsWebCodecsError(err, 'EncodingError'));
    }
  }

  static async isConfigSupported(config: AudioDecoderConfig): Promise<AudioDecoderSupport> {
    // Validate required fields and types - throw TypeError for invalid types
    if (!config || typeof config !== 'object') {
      throw new TypeError('config must be an object');
    }
    if (config.codec === undefined || config.codec === null) {
      throw new TypeError("Failed to read the 'codec' property from 'AudioDecoderConfig': Required member is undefined.");
    }
    if (typeof config.codec !== 'string' || config.codec === '') {
      throw new TypeError('codec must be a non-empty string');
    }
    if (config.sampleRate === undefined || config.sampleRate === null) {
      throw new TypeError("Failed to read the 'sampleRate' property from 'AudioDecoderConfig': Required member is undefined.");
    }
    if (typeof config.sampleRate !== 'number' || !Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
      throw new TypeError('sampleRate must be a finite positive number');
    }
    if (config.numberOfChannels === undefined || config.numberOfChannels === null) {
      throw new TypeError("Failed to read the 'numberOfChannels' property from 'AudioDecoderConfig': Required member is undefined.");
    }
    if (typeof config.numberOfChannels !== 'number' || !Number.isFinite(config.numberOfChannels) || config.numberOfChannels <= 0 || !Number.isInteger(config.numberOfChannels)) {
      throw new TypeError('numberOfChannels must be a positive integer');
    }

    // Validate description is not detached
    if (config.description !== undefined) {
      const desc = config.description;
      if (desc instanceof ArrayBuffer) {
        // Check if ArrayBuffer is detached (byteLength becomes 0)
        // Note: Can't distinguish between empty and detached without 'detached' property
        // In Node.js 20+, we can check the 'detached' property
        if ((desc as any).detached === true) {
          throw new TypeError('description buffer is detached');
        }
      } else if (ArrayBuffer.isView(desc)) {
        if ((desc.buffer as any).detached === true) {
          throw new TypeError('description buffer is detached');
        }
        // Also check for views that reference detached buffers
        if (desc.buffer.byteLength === 0 && desc.byteLength !== 0) {
          throw new TypeError('description buffer is detached');
        }
      }
    }

    // Clone the config per WebCodecs spec (strip unknown fields)
    const clonedConfig: AudioDecoderConfig = {
      codec: config.codec,
      sampleRate: config.sampleRate,
      numberOfChannels: config.numberOfChannels,
    };

    // Copy description if provided (clone the buffer)
    if (config.description !== undefined) {
      const desc = config.description;
      if (desc instanceof ArrayBuffer) {
        clonedConfig.description = desc.slice(0) as ArrayBuffer;
      } else if (ArrayBuffer.isView(desc)) {
        // Create a new Uint8Array copy to ensure we have an ArrayBuffer
        const copy = new Uint8Array(desc.byteLength);
        copy.set(new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength));
        clonedConfig.description = copy.buffer;
      }
    }

    // Copy outputFormat if valid
    if (config.outputFormat !== undefined) {
      if (config.outputFormat in AUDIO_OUTPUT_FORMAT_MAP) {
        clonedConfig.outputFormat = config.outputFormat;
      } else {
        throw new TypeError(`Invalid outputFormat: ${config.outputFormat}`);
      }
    }

    const codecBase = getCodecBase(config.codec);

    // Opus with >2 channels requires description (mapping table)
    if (codecBase === 'opus' && config.numberOfChannels > 2 && config.description === undefined) {
      return { supported: false, config: clonedConfig };
    }

    const supported = codecBase in AUDIO_DECODER_CODEC_MAP || config.codec in AUDIO_DECODER_CODEC_MAP;

    return { supported, config: clonedConfig };
  }

  configure(config: AudioDecoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    validateRequired(config, 'config');
    if (typeof config !== 'object') {
      throw new TypeError('config must be an object');
    }
    validateNonEmptyString(config.codec, 'codec');
    validatePositiveInteger(config.sampleRate, 'sampleRate');
    validatePositiveInteger(config.numberOfChannels, 'numberOfChannels');

    const codecBase = getCodecBase(config.codec);
    if (!(codecBase in AUDIO_DECODER_CODEC_MAP) && !(config.codec in AUDIO_DECODER_CODEC_MAP)) {
      throw new DOMException(`Codec '${config.codec}' is not supported`, 'NotSupportedError');
    }

    if (config.outputFormat !== undefined && !(config.outputFormat in AUDIO_OUTPUT_FORMAT_MAP)) {
      throw new TypeError(`Invalid outputFormat: ${config.outputFormat}`);
    }

    // Check for detached description ArrayBuffer
    if (config.description !== undefined) {
      const desc = config.description;
      const buffer = desc instanceof ArrayBuffer ? desc : (desc as ArrayBufferView).buffer;
      // Check using Node.js 20+ .detached property or fallback to byteLength check
      const isDetached = (buffer as any).detached === true ||
        ((buffer as any).detached === undefined && buffer.byteLength === 0 &&
         !(desc instanceof ArrayBuffer && desc.byteLength === 0));
      if (isDetached) {
        throw new TypeError('description ArrayBuffer is detached');
      }
    }

    // Opus with >2 channels requires description (mapping table per WebCodecs spec)
    if (codecBase === 'opus' && config.numberOfChannels > 2 && config.description === undefined) {
      throw new DOMException('Opus decoder with >2 channels requires description (mapping table)', 'NotSupportedError');
    }

    this._stopDecoder();

    this._config = { ...config };
    this._outputFormat = config.outputFormat ?? 'f32';
    this._state = 'configured';
    this._frameIndex = 0;
    this._aacConfig = this._parseAacDescription(config);

    this._startDecoder();
  }

  decode(chunk: EncodedAudioChunk): void {
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

    if (!(chunk instanceof EncodedAudioChunk)) {
      throw new TypeError('chunk must be an EncodedAudioChunk');
    }

    if (!this._decoder?.isHealthy) {
      this._safeErrorCallback(encodingError('Decoder is not healthy'));
      return;
    }

    // Check queue saturation to prevent unbounded memory growth
    if (this._decodeQueueSize >= MAX_QUEUE_SIZE) {
      this._safeErrorCallback(new DOMException(
        `Decoder queue saturated (${MAX_QUEUE_SIZE} chunks pending). Wait for dequeue events before decoding more chunks.`,
        'QuotaExceededError'
      ));
      return;
    }

    this._decodeQueueSize++;

    try {
      const bufferData = Buffer.from(chunk._rawData);
      this._decoder.write(bufferData, chunk.timestamp);
    } catch {
      this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
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
        this._frameIndex = 0;
        this._decoder = null;
        this._flushPromise = null;
        if (this._config) {
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

      this._decoder.once('close', doResolve);
      this._decoder.once('error', doReject);
      this._decoder.end();
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
    this._frameIndex = 0;
    this._aacConfig = null;
    this._flushPromise = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopDecoder();
    this._state = 'closed';
    this._config = null;
    this._decodeQueueSize = 0;
    this._aacConfig = null;
    this._flushPromise = null;
  }

  private _startDecoder(): void {
    if (!this._config) return;

    this._decoder = new NodeAvAudioDecoder();
    this._decoder.startDecoder({
      codec: this._config.codec,
      sampleRate: this._config.sampleRate,
      numberOfChannels: this._config.numberOfChannels,
      description: this._config.description,
      outputFormat: this._outputFormat,
    });

    this._decoder.on('frame', (frame: { data?: Buffer; nativeFrame?: NativeFrame; numberOfFrames: number; timestamp: number }) => {
      this._handleDecodedFrame(frame);
    });

    this._decoder.on('chunkAccepted', () => {
      // Chunk has been accepted for decoding - decrement queue and fire dequeue event
      // This matches WebCodecs semantics: decodeQueueSize tracks chunks, not frames
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

  private _handleDecodedFrame(frame: { data?: Buffer; nativeFrame?: NativeFrame; numberOfFrames: number; timestamp: number }): void {
    if (!this._config) return;

    // Use actual timestamp from the decoded frame (in microseconds)
    const timestamp = frame.timestamp;

    // Build init with optional native frame properties
    const init: {
      format: AudioSampleFormat;
      sampleRate: number;
      numberOfChannels: number;
      numberOfFrames: number;
      timestamp: number;
      data: Uint8Array;
      _nativeFrame?: NativeFrame;
      _nativeCleanup?: () => void;
    } = {
      format: this._outputFormat,
      sampleRate: this._config.sampleRate,
      numberOfChannels: this._config.numberOfChannels,
      numberOfFrames: frame.numberOfFrames,
      timestamp,
      data: new Uint8Array(0),
    };

    if (frame.nativeFrame) {
      init._nativeFrame = frame.nativeFrame;
      init._nativeCleanup = () => {
        try {
          if (frame.nativeFrame && hasUnref(frame.nativeFrame)) {
            frame.nativeFrame.unref();
          }
        } catch {
          // ignore cleanup errors
        }
      };
    } else if (frame.data) {
      init.data = new Uint8Array(frame.data);
    }

    const audioData = new AudioData(init);

    this._frameIndex += frame.numberOfFrames;
    // Note: Queue decrement is handled by 'chunkAccepted' event, not here
    // This ensures decodeQueueSize tracks chunks (not frames) per WebCodecs spec

    this._safeOutputCallback(audioData);
  }

  private _parseAacDescription(config: AudioDecoderConfig): AacConfig | null {
    const codecBase = getCodecBase(config.codec);
    const isAac = codecBase === 'mp4a' || codecBase === 'aac';

    if (!isAac || !config.description) {
      return null;
    }

    try {
      const bytes = toUint8Array(config.description);
      const copy = new Uint8Array(bytes);
      return parseAudioSpecificConfig(copy);
    } catch {
      return null;
    }
  }
}
