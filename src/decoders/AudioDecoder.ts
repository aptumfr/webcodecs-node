/**
 * AudioDecoder - Decodes EncodedAudioChunks into AudioData
 * https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { AudioData } from '../core/AudioData.js';
import type { AudioSampleFormat } from '../core/AudioData.js';
import { EncodedAudioChunk } from '../core/EncodedAudioChunk.js';
import { DOMException } from '../types/index.js';
import { createLogger } from '../utils/index.js';
import {
  getAudioDecoderInfo,
  getAudioOutputFormatSettings,
  AUDIO_DECODER_CODEC_MAP,
  AUDIO_OUTPUT_FORMAT_MAP,
} from '../ffmpeg/audio-codecs.js';
import type { AacConfig } from '../utils/aac.js';
import { parseAudioSpecificConfig, wrapAacFrameWithAdts } from '../utils/aac.js';
import { NodeAvAudioDecoder } from '../node-av/NodeAvAudioDecoder.js';

const logger = createLogger('AudioDecoder');

export type CodecState = 'unconfigured' | 'configured' | 'closed';

export interface AudioDecoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: ArrayBuffer | ArrayBufferView;
  outputFormat?: AudioSampleFormat;
  backend?: 'node-av' | 'ffmpeg';
}

export interface AudioDecoderInit {
  output: (data: AudioData) => void;
  error: (error: Error) => void;
}

export interface AudioDecoderSupport {
  supported: boolean;
  config: AudioDecoderConfig;
}

const DEFAULT_FLUSH_TIMEOUT = 30000;

interface DecoderBackend {
  write(data: Buffer): boolean;
  end(): void;
  kill(): void;
  on(event: string, handler: (...args: any[]) => void): void;
  once(event: string, handler: (...args: any[]) => void): void;
  isHealthy: boolean;
}

export class AudioDecoder extends EventEmitter {
  private _state: CodecState = 'unconfigured';
  private _decodeQueueSize = 0;
  private _config: AudioDecoderConfig | null = null;
  private _outputCallback: (data: AudioData) => void;
  private _errorCallback: (error: Error) => void;
  private _backend: DecoderBackend | null = null;
  private _backendName: 'node-av' | 'ffmpeg' = 'node-av';
  private _accumulatedData: Buffer = Buffer.alloc(0);
  private _frameIndex = 0;
  private _resolveFlush: (() => void) | null = null;
  private _outputFormat: AudioSampleFormat = 'f32';
  private _aacConfig: AacConfig | null = null;

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

  private get _isBackendHealthy(): boolean {
    if (!this._backend) return false;
    return this._backend.isHealthy;
  }

  private _safeErrorCallback(error: Error): void {
    try {
      this._errorCallback(error);
    } catch {
      this.emit('callbackError', error);
    }
  }

  private _safeOutputCallback(data: AudioData): void {
    try {
      this._outputCallback(data);
    } catch (err) {
      this._safeErrorCallback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  static async isConfigSupported(config: AudioDecoderConfig): Promise<AudioDecoderSupport> {
    if (!config.codec || !config.sampleRate || !config.numberOfChannels) {
      return { supported: false, config };
    }

    const codecBase = config.codec.split('.')[0].toLowerCase();
    const supported = codecBase in AUDIO_DECODER_CODEC_MAP || config.codec in AUDIO_DECODER_CODEC_MAP;

    return { supported, config };
  }

  configure(config: AudioDecoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    if (!config || typeof config !== 'object') {
      throw new TypeError('config must be an object');
    }
    if (typeof config.codec !== 'string' || config.codec.length === 0) {
      throw new TypeError('codec must be a non-empty string');
    }
    if (typeof config.sampleRate !== 'number' || config.sampleRate <= 0 || !Number.isInteger(config.sampleRate)) {
      throw new TypeError('sampleRate must be a positive integer');
    }
    if (typeof config.numberOfChannels !== 'number' || config.numberOfChannels <= 0 || !Number.isInteger(config.numberOfChannels)) {
      throw new TypeError('numberOfChannels must be a positive integer');
    }

    const codecBase = config.codec.split('.')[0].toLowerCase();
    if (!(codecBase in AUDIO_DECODER_CODEC_MAP) && !(config.codec in AUDIO_DECODER_CODEC_MAP)) {
      throw new DOMException(`Codec '${config.codec}' is not supported`, 'NotSupportedError');
    }

    if (config.outputFormat !== undefined && !(config.outputFormat in AUDIO_OUTPUT_FORMAT_MAP)) {
      throw new TypeError(`Invalid outputFormat: ${config.outputFormat}`);
    }

    this._stopBackend();

    this._config = { ...config };
    this._outputFormat = config.outputFormat ?? 'f32';
    this._state = 'configured';
    this._frameIndex = 0;
    this._accumulatedData = Buffer.alloc(0);
    this._aacConfig = this._parseAacDescription(config);

    this._startBackend();
  }

  decode(chunk: EncodedAudioChunk): void {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
    }

    if (!(chunk instanceof EncodedAudioChunk)) {
      throw new TypeError('chunk must be an EncodedAudioChunk');
    }

    if (!this._isBackendHealthy) {
      this._safeErrorCallback(new Error('Decoder backend is not healthy'));
      return;
    }

    this._decodeQueueSize++;

    try {
      const bufferData = Buffer.from(chunk._rawData);
      this._backend!.write(bufferData);
    } catch {
      this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
      this._safeErrorCallback(new Error('Failed to write chunk data to decoder'));
    }
  }

  async flush(timeout: number = DEFAULT_FLUSH_TIMEOUT): Promise<void> {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
    }

    return new Promise((resolve, reject) => {
      if (!this._backend) {
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
        this._resolveFlush = null;
      };

      const doResolve = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this._decodeQueueSize = 0;
        this._frameIndex = 0;
        this._accumulatedData = Buffer.alloc(0);
        this._backend = null;
        if (this._config) {
          this._startBackend();
        }
        resolve();
      };

      const doReject = (err: Error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(err);
      };

      timeoutId = setTimeout(() => {
        doReject(new DOMException('Flush operation timed out', 'TimeoutError'));
      }, timeout);

      this._backend.once('close', doResolve);
      this._backend.once('error', doReject);
      this._backend.end();
    });
  }

  reset(): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    this._stopBackend();
    this._state = 'unconfigured';
    this._config = null;
    this._decodeQueueSize = 0;
    this._frameIndex = 0;
    this._accumulatedData = Buffer.alloc(0);
    this._aacConfig = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    this._stopBackend();
    this._state = 'closed';
    this._config = null;
    this._decodeQueueSize = 0;
    this._aacConfig = null;
  }

  private _startBackend(): void {
    if (!this._config) return;

    const requestedBackend = this._config.backend ?? process.env.WEBCODECS_BACKEND ?? 'node-av';

    // Use node-av for all codecs unless explicitly requesting ffmpeg
    if (requestedBackend !== 'ffmpeg') {
      try {
        this._startNodeAvBackend();
        this._backendName = 'node-av';
        return;
      } catch {
        // Fall through to ffmpeg CLI
      }
    }

    this._startFFmpegBackend();
    this._backendName = 'ffmpeg';
  }

  private _startNodeAvBackend(): void {
    if (!this._config) return;

    const decoder = new NodeAvAudioDecoder();
    decoder.startDecoder({
      codec: this._config.codec,
      sampleRate: this._config.sampleRate,
      numberOfChannels: this._config.numberOfChannels,
      description: this._config.description,
      outputFormat: this._outputFormat,
    });

    decoder.on('frame', (frame: { data: Buffer; numberOfFrames: number; timestamp: number }) => {
      this._handleDecodedFrame(frame);
    });

    decoder.on('error', (err: Error) => {
      this._safeErrorCallback(err);
    });

    decoder.on('close', () => {
      if (this._accumulatedData.length > 0) {
        this._emitAudioData(this._accumulatedData);
        this._accumulatedData = Buffer.alloc(0);
      }
    });

    this._backend = decoder;
  }

  private _startFFmpegBackend(): void {
    if (!this._config) return;

    const codecInfo = getAudioDecoderInfo(this._config.codec);
    const outputInfo = getAudioOutputFormatSettings(this._outputFormat);

    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', codecInfo.format,
      '-i', 'pipe:0',
      '-f', outputInfo.ffmpegFormat,
      '-ar', String(this._config.sampleRate),
      '-ac', String(this._config.numberOfChannels),
    ];

    if (outputInfo.isPlanar) {
      args.push('-channel_layout', this._getChannelLayout(this._config.numberOfChannels));
    }

    args.push('pipe:1');

    const process = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    process.stdout?.on('data', (data: Buffer) => {
      this._accumulatedData = Buffer.concat([this._accumulatedData, data]);
      this._emitDecodedFrames();
    });

    process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (!msg.includes('Discarding') && !msg.includes('invalid')) {
        logger.warn('FFmpeg stderr', { message: msg });
      }
    });

    process.on('close', () => {
      if (this._accumulatedData.length > 0) {
        this._emitAudioData(this._accumulatedData);
        this._accumulatedData = Buffer.alloc(0);
      }

      this._decodeQueueSize = 0;

      const wasFlushing = Boolean(this._resolveFlush);
      if (this._resolveFlush) {
        this._resolveFlush();
        this._resolveFlush = null;
      }

      if (wasFlushing && this._state === 'configured' && this._config) {
        this._backend = null;
        this._startBackend();
      }
    });

    process.stdin?.on('error', () => {});

    // Wrap ChildProcess to match DecoderBackend interface
    this._backend = {
      write: (data: Buffer) => {
        try {
          let dataToWrite: Buffer | Uint8Array = data;
          if (this._aacConfig) {
            dataToWrite = Buffer.from(wrapAacFrameWithAdts(new Uint8Array(data), this._aacConfig));
          }
          process.stdin!.write(dataToWrite);
          return true;
        } catch {
          return false;
        }
      },
      end: () => {
        process.stdin?.end();
      },
      kill: () => {
        process.kill('SIGTERM');
      },
      on: (event: string, handler: (...args: any[]) => void) => {
        process.on(event, handler);
      },
      once: (event: string, handler: (...args: any[]) => void) => {
        process.once(event, handler);
      },
      get isHealthy() {
        return process.stdin?.writable === true;
      },
    };
  }

  private _stopBackend(): void {
    if (this._backend) {
      this._backend.kill();
      this._backend = null;
    }
  }

  private _handleDecodedFrame(frame: { data: Buffer; numberOfFrames: number; timestamp: number }): void {
    if (!this._config) return;

    const timestamp = (this._frameIndex * 1_000_000) / this._config.sampleRate;

    const audioData = new AudioData({
      format: this._outputFormat,
      sampleRate: this._config.sampleRate,
      numberOfChannels: this._config.numberOfChannels,
      numberOfFrames: frame.numberOfFrames,
      timestamp,
      data: new Uint8Array(frame.data),
    });

    this._frameIndex += frame.numberOfFrames;
    this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
    this.emit('dequeue');

    this._safeOutputCallback(audioData);
  }

  private _parseAacDescription(config: AudioDecoderConfig): AacConfig | null {
    const codecBase = config.codec.split('.')[0].toLowerCase();
    const isAac = codecBase === 'mp4a' || codecBase === 'aac';

    if (!isAac || !config.description) {
      return null;
    }

    let bytes: Uint8Array;
    if (config.description instanceof ArrayBuffer) {
      bytes = new Uint8Array(config.description);
    } else if (ArrayBuffer.isView(config.description)) {
      bytes = new Uint8Array(
        config.description.buffer,
        config.description.byteOffset,
        config.description.byteLength
      );
    } else {
      return null;
    }

    const copy = new Uint8Array(bytes);

    try {
      return parseAudioSpecificConfig(copy);
    } catch {
      return null;
    }
  }

  private _getChannelLayout(numChannels: number): string {
    switch (numChannels) {
      case 1: return 'mono';
      case 2: return 'stereo';
      case 6: return '5.1';
      case 8: return '7.1';
      default: return `${numChannels}c`;
    }
  }

  private _emitDecodedFrames(): void {
    if (!this._config) return;

    const outputInfo = getAudioOutputFormatSettings(this._outputFormat);
    const samplesPerChunk = Math.floor(this._config.sampleRate * 0.02);
    const bytesPerSample = outputInfo.bytesPerSample;
    const bytesPerChunk = samplesPerChunk * this._config.numberOfChannels * bytesPerSample;

    while (this._accumulatedData.length >= bytesPerChunk) {
      const chunkData = Buffer.from(this._accumulatedData.subarray(0, bytesPerChunk));
      this._accumulatedData = this._accumulatedData.subarray(bytesPerChunk);
      this._emitAudioData(chunkData);
    }
  }

  private _emitAudioData(data: Buffer): void {
    if (!this._config || data.length === 0) return;

    const outputInfo = getAudioOutputFormatSettings(this._outputFormat);
    const bytesPerSample = outputInfo.bytesPerSample;
    const numberOfFrames = Math.floor(data.length / (this._config.numberOfChannels * bytesPerSample));

    if (numberOfFrames === 0) return;

    let outputData: Uint8Array;
    if (outputInfo.isPlanar) {
      outputData = this._convertToPlanar(data, numberOfFrames, bytesPerSample);
    } else {
      outputData = new Uint8Array(data);
    }

    const timestamp = (this._frameIndex * 1_000_000) / this._config.sampleRate;

    const audioData = new AudioData({
      format: this._outputFormat,
      sampleRate: this._config.sampleRate,
      numberOfChannels: this._config.numberOfChannels,
      numberOfFrames,
      timestamp,
      data: outputData,
    });

    this._frameIndex += numberOfFrames;
    this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
    this.emit('dequeue');

    this._safeOutputCallback(audioData);
  }

  private _convertToPlanar(data: Buffer, numberOfFrames: number, bytesPerSample: number): Uint8Array {
    if (!this._config) return new Uint8Array(data);

    const numChannels = this._config.numberOfChannels;
    const result = new Uint8Array(data.length);
    const planeSize = numberOfFrames * bytesPerSample;

    for (let frame = 0; frame < numberOfFrames; frame++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const srcOffset = (frame * numChannels + ch) * bytesPerSample;
        const dstOffset = ch * planeSize + frame * bytesPerSample;

        for (let b = 0; b < bytesPerSample; b++) {
          result[dstOffset + b] = data[srcOffset + b];
        }
      }
    }

    return result;
  }
}
