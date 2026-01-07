/**
 * NodeAvAudioEncoder - Audio encoder using node-av native bindings
 *
 * Implements the AudioEncoderBackend interface for encoding audio samples
 * using FFmpeg's libav* libraries via node-av.
 */

import { EventEmitter } from 'events';

import { Encoder, FilterAPI } from 'node-av/api';
import { Frame, Rational } from 'node-av/lib';
import {
  AV_SAMPLE_FMT_FLTP,
  AV_SAMPLE_FMT_S16P,
  AV_SAMPLE_FMT_S16,
  AV_SAMPLE_FMT_FLT,
  AV_SAMPLE_FMT_U8,
  AV_SAMPLE_FMT_S32,
  type AVSampleFormat,
  type FFEncoderCodec,
} from 'node-av/constants';

import type {
  AudioEncoderBackend,
  AudioEncoderBackendConfig,
} from '../../types.js';
import { createLogger } from '../../../utils/logger.js';

// Import from encoder submodule
import {
  OPUS_SAMPLE_RATE,
  getEncoderName,
  getEncoderCodec,
  getChannelLayout,
  convertToPlanar,
  convertToS16Interleaved,
  convertToS32Interleaved,
  convertToS16Planar,
  convertToU8Interleaved,
  convertFromPlanarToInterleaved,
  convertFromS16ToF32Interleaved,
  convertFromS16PlanarToF32Interleaved,
  convertFromS32ToF32Interleaved,
  buildAudioEncoderOptions,
  extractCodecDescription,
  drainAudioPackets,
} from './encoder/index.js';

const logger = createLogger('NodeAvAudioEncoder');

/**
 * NodeAV-backed audio encoder implementing AudioEncoderBackend interface
 */
export class NodeAvAudioEncoder extends EventEmitter implements AudioEncoderBackend {
  private encoder: Encoder | null = null;
  private config: AudioEncoderBackendConfig | null = null;
  private frameIndex = 0;
  private queue: Array<{ buffer?: Buffer; frame?: Frame; owned?: boolean; timestamp?: number }> = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private sampleFormat: AVSampleFormat = AV_SAMPLE_FMT_FLT;
  private encoderSampleFormat: AVSampleFormat = AV_SAMPLE_FMT_FLTP;
  private timeBase: Rational = new Rational(1, 1_000_000);
  private codecDescription: Buffer | null = null;
  private firstFrame = true;
  private pendingTimestamp = 0;
  private resampler: FilterAPI | null = null;
  private needsResampling = false;
  private inputSampleRate = 0;
  private encoderSampleRate = 0;

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startEncoder(config: AudioEncoderBackendConfig): void {
    this.config = { ...config };

    const codecName = getEncoderName(config.codec);
    const isOpus = codecName === 'libopus';

    this.inputSampleRate = config.sampleRate;
    this.encoderSampleRate = isOpus ? OPUS_SAMPLE_RATE : config.sampleRate;

    this.needsResampling = isOpus && config.sampleRate !== OPUS_SAMPLE_RATE;
    if (this.needsResampling) {
      logger.info(`Opus requires 48kHz, will resample from ${config.sampleRate}Hz`);
    }

    this.timeBase = new Rational(1, this.encoderSampleRate);
    this.sampleFormat = AV_SAMPLE_FMT_FLT;
  }

  write(data: Buffer | Uint8Array, timestamp?: number): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    this.queue.push({ buffer: Buffer.from(data), owned: true, timestamp: timestamp ?? this.pendingTimestamp });
    const samplesPerChannel = data.byteLength / 4 / (this.config.numberOfChannels ?? 2);
    this.pendingTimestamp += (samplesPerChannel * 1_000_000) / this.config.sampleRate;
    void this.processQueue();
    return true;
  }

  writeFrame(frame: Frame, owned: boolean = true, timestamp?: number): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    try {
      const buf = frame.toBuffer();
      if (owned) {
        try { frame.unref(); } catch { /* ignore */ }
      }
      let ts = timestamp;
      if (ts === undefined && (frame as any).pts !== undefined) {
        const pts = (frame as any).pts;
        const tb = (frame as any).timeBase;
        if (tb && typeof tb.num === 'number' && typeof tb.den === 'number') {
          ts = Number((BigInt(pts) * BigInt(tb.num) * 1_000_000n) / BigInt(tb.den));
        }
      }
      this.queue.push({ buffer: Buffer.from(buf), owned: true, timestamp: ts ?? 0 });
      void this.processQueue();
      return true;
    } catch (err) {
      if (owned) {
        try { frame.unref(); } catch { /* ignore */ }
      }
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  end(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    void this.finish().catch((err) => this.emit('error', err));
  }

  kill(): void {
    this.shuttingDown = true;
    this.cleanup();
    this.emit('close', null);
  }

  async shutdown(): Promise<void> {
    this.end();
  }

  private async processQueue(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
      if (this.processing) return;
      this.processing = true;

      try {
        while (this.queue.length > 0) {
          const item = this.queue.shift()!;
          setImmediate(() => this.emit('frameAccepted'));
          if (item.frame) {
            await this.encodeFrame(item.frame, item.owned ?? true, item.timestamp);
          } else if (item.buffer) {
            await this.encodeBuffer(item.buffer, item.timestamp);
          }
        }
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      } finally {
        this.processing = false;
        this.processingPromise = null;
      }
    })();

    return this.processingPromise;
  }

  private async ensureEncoder(): Promise<void> {
    if (this.encoder || !this.config) {
      return;
    }

    const encoderCodec = getEncoderCodec(this.config.codec);
    const options = buildAudioEncoderOptions(this.config, this.timeBase);

    this.encoderSampleFormat = options.sampleFormat;

    logger.info(`Using encoder: ${encoderCodec}, format: ${options.sampleFormat}`);

    this.encoder = await Encoder.create(encoderCodec as FFEncoderCodec, options);

    if (this.needsResampling && !this.resampler) {
      const filterDesc = `aresample=${this.encoderSampleRate}:first_pts=0`;
      this.resampler = FilterAPI.create(filterDesc, {} as any);
      logger.info(`Created resampler: ${this.inputSampleRate}Hz -> ${this.encoderSampleRate}Hz`);
    }

    this.tryExtractCodecDescription();
  }

  private tryExtractCodecDescription(): void {
    if (this.codecDescription || !this.encoder || !this.config) return;

    this.codecDescription = extractCodecDescription(this.encoder, {
      codec: this.config.codec,
      numberOfChannels: this.config.numberOfChannels,
      inputSampleRate: this.inputSampleRate,
    });
  }

  private async encodeFrame(inputFrame: Frame, owned: boolean, timestamp?: number): Promise<void> {
    try {
      await this.ensureEncoder();
      if (!this.encoder || !this.config) {
        throw new Error('Encoder not initialized');
      }

      const inputTimestamp = timestamp ?? this.pendingTimestamp;

      const matchesFormat = inputFrame.format === this.encoderSampleFormat;
      const matchesRate = Number(inputFrame.sampleRate ?? this.config.sampleRate) === this.config.sampleRate;

      if (matchesFormat && matchesRate) {
        const sampleRate = Number(inputFrame.sampleRate ?? this.config.sampleRate);
        inputFrame.pts = BigInt(Math.round(inputTimestamp * sampleRate / 1_000_000));
        const nbSamples = inputFrame.nbSamples ?? 0;
        try {
          await this.encoder.encode(inputFrame);
          if (owned) {
            inputFrame.unref();
          }
          await this.drainPackets();
          this.frameIndex += nbSamples;
          return;
        } catch (err) {
          logger.debug(`Direct frame encode failed, falling back to buffer: ${err instanceof Error ? err.message : err}`);
        }
      }

      const nativeFormat = inputFrame.format as AVSampleFormat;
      const nbSamples = inputFrame.nbSamples ?? 0;
      const numChannels = this.config.numberOfChannels;

      const rawBuffer = inputFrame.toBuffer();
      if (owned) {
        inputFrame.unref();
      }

      let f32Buffer: Buffer;
      if (nativeFormat === AV_SAMPLE_FMT_FLT) {
        f32Buffer = rawBuffer;
      } else if (nativeFormat === AV_SAMPLE_FMT_FLTP) {
        f32Buffer = Buffer.from(convertFromPlanarToInterleaved(rawBuffer, nbSamples, numChannels));
      } else if (nativeFormat === AV_SAMPLE_FMT_S16) {
        f32Buffer = Buffer.from(convertFromS16ToF32Interleaved(rawBuffer, nbSamples, numChannels));
      } else if (nativeFormat === AV_SAMPLE_FMT_S16P) {
        f32Buffer = Buffer.from(convertFromS16PlanarToF32Interleaved(rawBuffer, nbSamples, numChannels));
      } else if (nativeFormat === AV_SAMPLE_FMT_S32) {
        f32Buffer = Buffer.from(convertFromS32ToF32Interleaved(rawBuffer, nbSamples, numChannels));
      } else {
        logger.warn(`Unsupported native frame format ${nativeFormat}, attempting direct conversion`);
        f32Buffer = rawBuffer;
      }

      await this.encodeBuffer(f32Buffer, inputTimestamp);
    } catch (err) {
      if (owned) {
        try { inputFrame.unref(); } catch { /* ignore */ }
      }
      throw err;
    }
  }

  private async encodeBuffer(buffer: Buffer, timestamp?: number): Promise<void> {
    await this.ensureEncoder();
    if (!this.encoder || !this.config) {
      throw new Error('Encoder not initialized');
    }

    const inputTimestamp = timestamp ?? this.pendingTimestamp;
    const bytesPerSample = 4;
    const totalSamples = buffer.length / bytesPerSample;
    const samplesPerChannel = Math.floor(totalSamples / this.config.numberOfChannels);

    if (samplesPerChannel === 0) {
      return;
    }

    let audioData: Buffer;
    let frameFormat: AVSampleFormat;

    if (this.encoderSampleFormat === AV_SAMPLE_FMT_FLT) {
      audioData = buffer;
      frameFormat = AV_SAMPLE_FMT_FLT;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_S16) {
      audioData = Buffer.from(convertToS16Interleaved(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_S16;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_S16P) {
      audioData = Buffer.from(convertToS16Planar(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_S16P;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_S32) {
      audioData = Buffer.from(convertToS32Interleaved(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_S32;
    } else if (this.encoderSampleFormat === AV_SAMPLE_FMT_U8) {
      audioData = Buffer.from(convertToU8Interleaved(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_U8;
    } else {
      audioData = Buffer.from(convertToPlanar(buffer, samplesPerChannel, this.config.numberOfChannels));
      frameFormat = AV_SAMPLE_FMT_FLTP;
    }

    const inputFrame = Frame.fromAudioBuffer(audioData, {
      sampleRate: this.inputSampleRate,
      channelLayout: getChannelLayout(this.config.numberOfChannels),
      format: frameFormat,
      nbSamples: samplesPerChannel,
      timeBase: new Rational(1, this.inputSampleRate),
    });

    if (this.needsResampling && this.resampler) {
      const ptsInSamples = BigInt(Math.round(inputTimestamp * this.inputSampleRate / 1_000_000));
      inputFrame.pts = ptsInSamples;

      await this.resampler.process(inputFrame);
      inputFrame.unref();

      let resampledSamplesOutput = 0;
      let resampledFrame = await this.resampler.receive();
      while (resampledFrame) {
        const outputSamples = resampledFrame.nbSamples ?? 0;
        const basePts = BigInt(Math.round(inputTimestamp * this.encoderSampleRate / 1_000_000));
        resampledFrame.pts = basePts + BigInt(resampledSamplesOutput);

        await this.encoder.encode(resampledFrame);
        resampledFrame.unref();

        resampledSamplesOutput += outputSamples;
        this.frameIndex += outputSamples;

        resampledFrame = await this.resampler.receive();
      }
    } else {
      const ptsInSamples = BigInt(Math.round(inputTimestamp * this.inputSampleRate / 1_000_000));
      inputFrame.pts = ptsInSamples;
      await this.encoder.encode(inputFrame);
      inputFrame.unref();
      this.frameIndex += samplesPerChannel;
    }

    this.tryExtractCodecDescription();
    await this.drainPackets();
  }

  private async finish(): Promise<void> {
    await this.processQueue();
    if (this.processingPromise) {
      await this.processingPromise;
    }

    if (this.resampler && this.encoder) {
      try {
        await this.resampler.process(null as any);

        let resampledFrame = await this.resampler.receive();
        while (resampledFrame) {
          const outputSamples = resampledFrame.nbSamples ?? 0;
          resampledFrame.pts = BigInt(this.frameIndex);
          await this.encoder.encode(resampledFrame);
          resampledFrame.unref();
          this.frameIndex += outputSamples;

          resampledFrame = await this.resampler.receive();
        }
        await this.drainPackets();
      } catch (err) {
        logger.debug(`Resampler flush error: ${err}`);
      }
    }

    if (this.encoder) {
      try {
        await this.encoder.flush();
        await this.drainPackets();
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    this.emit('close', 0);
    this.cleanup();
  }

  private async drainPackets(): Promise<void> {
    if (!this.encoder) return;

    const result = await drainAudioPackets(this.encoder, {
      codecDescription: this.codecDescription,
      encoderSampleRate: this.encoderSampleRate,
      frameIndex: this.frameIndex,
      firstFrame: this.firstFrame,
    });

    if (result.firstFrameEmitted) {
      this.firstFrame = false;
    }

    for (const frame of result.frames) {
      this.emit('encodedFrame', frame);
    }
  }

  private cleanup(): void {
    this.resampler?.close();
    this.resampler = null;
    this.encoder?.close();
    this.encoder = null;
    this.queue = [];
  }
}
