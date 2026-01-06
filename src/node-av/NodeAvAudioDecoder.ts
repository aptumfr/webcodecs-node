/**
 * NodeAvAudioDecoder - Audio decoder using node-av native bindings
 *
 * Implements the AudioDecoderBackend interface for decoding audio streams
 * using FFmpeg's libav* libraries via node-av.
 */

import { EventEmitter } from 'events';

import { Decoder, FilterAPI } from 'node-av/api';
import { FormatContext, Packet, Stream, Rational } from 'node-av/lib';
import {
  AVMEDIA_TYPE_AUDIO,
  AV_SAMPLE_FMT_FLT,
  AV_SAMPLE_FMT_FLTP,
  type AVSampleFormat,
} from 'node-av/constants';

import type {
  AudioDecoderBackend,
  AudioDecoderBackendConfig,
  DecodedFrame,
} from '../backends/types.js';
import type { AudioSampleFormat } from '../types/audio.js';
import { createLogger } from '../utils/logger.js';
import { toUint8Array } from '../utils/buffer.js';
import {
  mapCodecId,
  mapSampleFormat,
  sampleFormatToFFmpegName,
  getChannelLayout,
} from './audio-decoder/index.js';

const logger = createLogger('NodeAvAudioDecoder');

/**
 * NodeAV-backed audio decoder implementing AudioDecoderBackend interface
 */
export class NodeAvAudioDecoder extends EventEmitter implements AudioDecoderBackend {
  private decoder: Decoder | null = null;
  private formatContext: FormatContext | null = null;
  private stream: Stream | null = null;
  private filter: FilterAPI | null = null;
  private config: AudioDecoderBackendConfig | null = null;
  private queue: Array<{ buffer: Buffer; timestamp: number }> = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private packetIndex = 0;
  private frameIndex = 0;
  private pendingTimestamp = 0; // Track current chunk timestamp for output
  private packetTimeBase: Rational = new Rational(1, 1_000_000); // Microsecond timebase
  private outputSampleFormat: AVSampleFormat = AV_SAMPLE_FMT_FLT;
  private filterDescription: string | null = null;
  private outputFormat: AudioSampleFormat = 'f32';

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startDecoder(config: AudioDecoderBackendConfig): void {
    this.config = { ...config };
    // Keep packetTimeBase at microseconds (1/1_000_000) - do NOT change to sampleRate
    // packet.pts is set in microseconds, so timebase must match for correct timestamp conversion
    this.outputFormat = this.parseOutputFormat(config);
    this.outputSampleFormat = mapSampleFormat(this.outputFormat);
  }

  write(data: Buffer | Uint8Array, timestamp?: number): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    // Pass raw data with timestamp - extradata is set on the decoder context
    this.queue.push({ buffer: Buffer.from(data), timestamp: timestamp ?? 0 });
    void this.processQueue();
    return true;
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
          const { buffer, timestamp } = this.queue.shift()!;
          this.pendingTimestamp = timestamp;
          await this.decodeBuffer(buffer, timestamp);
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

  private async ensureDecoder(): Promise<void> {
    if (this.decoder || !this.config) {
      return;
    }

    const codecId = mapCodecId(this.config.codec);
    if (!codecId) {
      throw new Error(`Unsupported audio codec: ${this.config.codec}`);
    }

    this.formatContext = new FormatContext();
    this.formatContext.allocContext();
    this.stream = this.formatContext.newStream();
    this.stream.timeBase = this.packetTimeBase;

    const params = this.stream.codecpar;
    params.codecType = AVMEDIA_TYPE_AUDIO;
    params.codecId = codecId;
    params.sampleRate = this.config.sampleRate;
    params.channelLayout = getChannelLayout(this.config.numberOfChannels) as any;
    (params as any).channels = this.config.numberOfChannels;

    // Set extradata if we have description (e.g., AudioSpecificConfig for AAC)
    if (this.config.description) {
      const bytes = toUint8Array(this.config.description);
      params.extradata = Buffer.from(bytes);
    }

    this.decoder = await Decoder.create(this.stream, {
      exitOnError: true,
    });

    logger.info(`Created decoder for codec: ${this.config.codec}`);
  }

  private parseOutputFormat(config: AudioDecoderBackendConfig): AudioSampleFormat {
    const defaultFormat: AudioSampleFormat = 'f32';
    return config.outputFormat ?? defaultFormat;
  }

  private async decodeBuffer(buffer: Buffer, timestamp: number): Promise<void> {
    await this.ensureDecoder();
    if (!this.decoder || !this.stream) {
      throw new Error('Decoder not initialized');
    }

    const packet = new Packet();
    packet.alloc();
    packet.streamIndex = this.stream.index;
    // Use actual chunk timestamp (microseconds)
    packet.pts = BigInt(Math.round(timestamp));
    packet.dts = BigInt(Math.round(timestamp));
    packet.timeBase = this.packetTimeBase;
    packet.data = buffer;
    packet.duration = 1n; // Will be computed from frame output

    await this.decoder.decode(packet);
    packet.unref();

    // Emit chunkAccepted after packet is successfully decoded
    // This allows AudioDecoder to track queue size per chunk, not per frame
    this.emit('chunkAccepted');

    await this.drainFrames();
    this.packetIndex++;
  }

  private async drainFrames(): Promise<void> {
    if (!this.decoder) return;

    let frame = await this.decoder.receive();
    while (frame) {
      const nbSamples = frame.nbSamples;
      if (nbSamples > 0) {
        // Get timestamp from frame PTS (in microseconds, matching our timebase)
        // If no PTS available, fall back to computing from sample count
        let timestamp: number;
        if (frame.pts !== undefined && frame.pts >= 0n) {
          const tb = frame.timeBase;
          // Convert from frame timebase to microseconds
          timestamp = Number((frame.pts * BigInt(tb.num) * 1_000_000n) / BigInt(tb.den));
        } else {
          // Fallback: compute from sample position
          timestamp = (this.frameIndex * 1_000_000) / (this.config?.sampleRate ?? 48000);
        }

        const passthrough = this.canPassThrough(frame);
        if (passthrough) {
          this.emit('frame', {
            nativeFrame: frame,
            numberOfFrames: nbSamples,
            timestamp,
          });
          this.frameIndex += nbSamples;
        } else {
          const converted = await this.toOutputBuffer(frame);
          frame.unref();
          if (converted) {
            this.emit('frame', {
              data: converted,
              numberOfFrames: nbSamples,
              timestamp,
            });
            this.frameIndex += nbSamples;
          }
        }
      } else {
        frame.unref();
      }
      frame = await this.decoder.receive();
    }
  }

  private canPassThrough(frame: any): boolean {
    return frame.format === this.outputSampleFormat;
  }

  private async toOutputBuffer(frame: any): Promise<Buffer | null> {
    const frameFormat = frame.format as AVSampleFormat;
    const frameChannels = frame.channels || this.config?.numberOfChannels || 2;
    const nbSamples = frame.nbSamples;

    // If frame already matches requested format, just export
    if (frameFormat === this.outputSampleFormat) {
      return frame.toBuffer();
    }

    // For multi-channel audio (>2 channels), the filter has issues with channel layouts
    // Convert manually from planar float to interleaved float if needed
    if (frameChannels > 2 && frameFormat === AV_SAMPLE_FMT_FLTP && this.outputSampleFormat === AV_SAMPLE_FMT_FLT) {
      return this.convertPlanarToInterleaved(frame, nbSamples, frameChannels);
    }

    // For stereo/mono, use filter for conversion
    const outputFormatName = sampleFormatToFFmpegName(this.outputSampleFormat);
    const description = `aformat=sample_fmts=${outputFormatName}`;

    if (!this.filter || this.filterDescription !== description) {
      this.filter?.close();
      this.filter = FilterAPI.create(description, {} as any);
      this.filterDescription = description;
    }

    await this.filter.process(frame);

    let filtered = await this.filter.receive();
    while (filtered === null) {
      filtered = await this.filter.receive();
    }
    if (!filtered) {
      return null;
    }

    const buffer = filtered.toBuffer();
    filtered.unref();
    return buffer;
  }

  private convertPlanarToInterleaved(frame: any, nbSamples: number, numChannels: number): Buffer {
    // Get planar buffer from frame - each channel is stored separately
    const planarBuffer = frame.toBuffer() as Buffer;
    const bytesPerSample = 4; // float32
    const planeSize = nbSamples * bytesPerSample;

    // Create interleaved output
    const outputSize = nbSamples * numChannels * bytesPerSample;
    const output = Buffer.alloc(outputSize);

    // Convert from planar (LLLLLLLL RRRRRRRR ...) to interleaved (LRLRLRLR ...)
    const inputView = new Float32Array(planarBuffer.buffer, planarBuffer.byteOffset, planarBuffer.byteLength / 4);
    const outputView = new Float32Array(output.buffer, output.byteOffset, output.byteLength / 4);

    for (let s = 0; s < nbSamples; s++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const srcIdx = ch * nbSamples + s;
        const dstIdx = s * numChannels + ch;
        outputView[dstIdx] = inputView[srcIdx];
      }
    }

    return output;
  }

  private async finish(): Promise<void> {
    await this.processQueue();
    if (this.processingPromise) {
      await this.processingPromise;
    }

    if (this.decoder) {
      try {
        await this.decoder.flush();
        await this.drainFrames();
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    this.emit('close', 0);
    this.cleanup();
  }

  private cleanup(): void {
    this.filter?.close();
    this.filter = null;
    this.decoder?.close();
    this.decoder = null;
    this.formatContext = null;
    this.stream = null;
    this.queue = [];
  }
}
