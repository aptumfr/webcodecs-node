import { EventEmitter } from 'events';

import { Decoder, FilterAPI } from 'node-av/api';
import { FormatContext, Packet, Stream, Rational } from 'node-av/lib';
import {
  AVMEDIA_TYPE_AUDIO,
  AV_SAMPLE_FMT_FLT,
  AV_SAMPLE_FMT_FLTP,
  AV_SAMPLE_FMT_S16,
  AV_SAMPLE_FMT_S16P,
  AV_SAMPLE_FMT_S32,
  AV_SAMPLE_FMT_S32P,
  AV_SAMPLE_FMT_U8,
  AV_SAMPLE_FMT_U8P,
  AV_CODEC_ID_AAC,
  AV_CODEC_ID_OPUS,
  AV_CODEC_ID_MP3,
  AV_CODEC_ID_FLAC,
  AV_CODEC_ID_VORBIS,
  AV_CODEC_ID_PCM_S16LE,
  AV_CODEC_ID_PCM_F32LE,
  AV_CHANNEL_ORDER_NATIVE,
  AV_CH_LAYOUT_MONO,
  AV_CH_LAYOUT_STEREO,
  AV_CH_LAYOUT_5POINT1,
  AV_CH_LAYOUT_7POINT1,
  type AVSampleFormat,
  type AVCodecID,
} from 'node-av/constants';

import type { AudioSampleFormat } from '../types/audio.js';
import type { AacConfig } from '../utils/aac.js';
import { wrapAacFrameWithAdts } from '../utils/aac.js';

interface AudioDecoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: ArrayBuffer | ArrayBufferView;
  outputFormat?: AudioSampleFormat;
}

/**
 * NodeAV-backed audio decoder.
 *
 * Mirrors the FFmpeg spawn-based audio decoder surface so it can be swapped
 * without touching callers.
 */
export class NodeAvAudioDecoder extends EventEmitter {
  private decoder: Decoder | null = null;
  private formatContext: FormatContext | null = null;
  private stream: Stream | null = null;
  private filter: FilterAPI | null = null;
  private config: AudioDecoderConfig | null = null;
  private queue: Buffer[] = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private packetIndex = 0;
  private frameIndex = 0;
  private packetTimeBase: Rational = new Rational(1, 48000);
  private outputSampleFormat: AVSampleFormat = AV_SAMPLE_FMT_FLT;
  private filterDescription: string | null = null;
  private aacConfig: AacConfig | null = null;

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  /**
   * Start the audio decoder with given configuration.
   */
  startDecoder(config: AudioDecoderConfig): void {
    this.config = { ...config };
    this.packetTimeBase = new Rational(1, config.sampleRate);
    this.outputSampleFormat = mapSampleFormat(config.outputFormat ?? 'f32');
    this.aacConfig = this.parseAacDescription(config);
  }

  /**
   * Write encoded audio data to the decoder.
   */
  write(data: Buffer | Uint8Array): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    // If we have AAC config, wrap raw AAC frames with ADTS headers
    let dataToWrite = Buffer.from(data);
    if (this.aacConfig) {
      dataToWrite = Buffer.from(wrapAacFrameWithAdts(new Uint8Array(data), this.aacConfig));
    }

    this.queue.push(dataToWrite);
    void this.processQueue();
    return true;
  }

  /**
   * Signal end-of-stream; flush remaining frames and emit 'close'.
   */
  end(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    void this.finish().catch((err) => this.emit('error', err));
  }

  /**
   * Stop immediately.
   */
  kill(): void {
    this.shuttingDown = true;
    this.cleanup();
    this.emit('close', null);
  }

  /**
   * Graceful shutdown.
   */
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
          const data = this.queue.shift()!;
          await this.decodeBuffer(data);
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
    params.channelLayout = this.getChannelLayout(this.config.numberOfChannels) as any;
    (params as any).channels = this.config.numberOfChannels;

    // Set extradata if we have description (e.g., AudioSpecificConfig for AAC)
    if (this.config.description && !this.aacConfig) {
      const desc = this.config.description;
      let bytes: Uint8Array;
      if (desc instanceof ArrayBuffer) {
        bytes = new Uint8Array(desc);
      } else {
        bytes = new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
      }
      params.extradata = Buffer.from(bytes);
    }

    this.decoder = await Decoder.create(this.stream, {
      exitOnError: true,
    });

    console.log(`[NodeAvAudioDecoder] Created decoder for codec: ${this.config.codec}`);
  }

  private async decodeBuffer(buffer: Buffer): Promise<void> {
    await this.ensureDecoder();
    if (!this.decoder || !this.stream) {
      throw new Error('Decoder not initialized');
    }

    const packet = new Packet();
    packet.alloc();
    packet.streamIndex = this.stream.index;
    packet.pts = BigInt(this.packetIndex);
    packet.dts = BigInt(this.packetIndex);
    packet.timeBase = this.packetTimeBase;
    packet.data = buffer;
    packet.duration = 1n;

    await this.decoder.decode(packet);
    packet.unref();
    await this.drainFrames();
    this.packetIndex++;
  }

  private async drainFrames(): Promise<void> {
    if (!this.decoder) return;

    let frame = await this.decoder.receive();
    while (frame) {
      const nbSamples = frame.nbSamples;
      if (nbSamples > 0) {
        const converted = await this.toOutputBuffer(frame);
        frame.unref();
        if (converted) {
          this.emit('frame', {
            data: converted,
            numberOfFrames: nbSamples,
            timestamp: this.frameIndex,
          });
          this.frameIndex += nbSamples;
        }
      } else {
        frame.unref();
      }
      frame = await this.decoder.receive();
    }
  }

  private async toOutputBuffer(frame: any): Promise<Buffer | null> {
    const outputFormatName = sampleFormatToFFmpegName(this.outputSampleFormat);
    const frameFormat = frame.format as AVSampleFormat;

    // If frame already matches requested format, just export
    if (frameFormat === this.outputSampleFormat) {
      return frame.toBuffer();
    }

    // Need to convert using filter
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

  private parseAacDescription(config: AudioDecoderConfig): AacConfig | null {
    const codecBase = config.codec.split('.')[0].toLowerCase();
    const isAac = codecBase === 'mp4a' || codecBase === 'aac';

    if (!isAac || !config.description) {
      return null;
    }

    // Parse AudioSpecificConfig to get profile and sampling frequency index
    let bytes: Uint8Array;
    if (config.description instanceof ArrayBuffer) {
      bytes = new Uint8Array(config.description);
    } else {
      bytes = new Uint8Array(
        config.description.buffer,
        config.description.byteOffset,
        config.description.byteLength
      );
    }

    if (bytes.length < 2) {
      return null;
    }

    // Parse AudioSpecificConfig (ISO 14496-3)
    // First 5 bits: audioObjectType
    // Next 4 bits: samplingFrequencyIndex
    // Next 4 bits: channelConfiguration
    const audioObjectType = (bytes[0] >> 3) & 0x1f;
    const samplingFrequencyIndex = ((bytes[0] & 0x07) << 1) | ((bytes[1] >> 7) & 0x01);
    const channelConfiguration = (bytes[1] >> 3) & 0x0f;

    return {
      audioObjectType,
      samplingFrequencyIndex,
      samplingRate: config.sampleRate,
      channelConfiguration,
    };
  }

  private getChannelLayout(numChannels: number): { nbChannels: number; order: number; mask: bigint } {
    // Standard channel layouts as ChannelLayout objects
    // Order 1 = AV_CHANNEL_ORDER_NATIVE (required for FFmpeg)
    switch (numChannels) {
      case 1:
        return { nbChannels: 1, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_MONO };
      case 2:
        return { nbChannels: 2, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_STEREO };
      case 6:
        return { nbChannels: 6, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_5POINT1 };
      case 8:
        return { nbChannels: 8, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_7POINT1 };
      default:
        return { nbChannels: numChannels, order: AV_CHANNEL_ORDER_NATIVE, mask: BigInt((1 << numChannels) - 1) };
    }
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

function mapCodecId(codec: string): AVCodecID | null {
  const codecBase = codec.split('.')[0].toLowerCase();
  switch (codecBase) {
    case 'mp4a':
    case 'aac':
      return AV_CODEC_ID_AAC;
    case 'opus':
      return AV_CODEC_ID_OPUS;
    case 'mp3':
      return AV_CODEC_ID_MP3;
    case 'flac':
      return AV_CODEC_ID_FLAC;
    case 'vorbis':
      return AV_CODEC_ID_VORBIS;
    case 'pcm-s16':
      return AV_CODEC_ID_PCM_S16LE;
    case 'pcm-f32':
      return AV_CODEC_ID_PCM_F32LE;
    default:
      return null;
  }
}

function mapSampleFormat(format: AudioSampleFormat): AVSampleFormat {
  switch (format) {
    case 'u8':
      return AV_SAMPLE_FMT_U8;
    case 'u8-planar':
      return AV_SAMPLE_FMT_U8P;
    case 's16':
      return AV_SAMPLE_FMT_S16;
    case 's16-planar':
      return AV_SAMPLE_FMT_S16P;
    case 's32':
      return AV_SAMPLE_FMT_S32;
    case 's32-planar':
      return AV_SAMPLE_FMT_S32P;
    case 'f32':
      return AV_SAMPLE_FMT_FLT;
    case 'f32-planar':
      return AV_SAMPLE_FMT_FLTP;
    default:
      return AV_SAMPLE_FMT_FLT;
  }
}

function sampleFormatToFFmpegName(fmt: AVSampleFormat): string {
  switch (fmt) {
    case AV_SAMPLE_FMT_U8:
      return 'u8';
    case AV_SAMPLE_FMT_U8P:
      return 'u8p';
    case AV_SAMPLE_FMT_S16:
      return 's16';
    case AV_SAMPLE_FMT_S16P:
      return 's16p';
    case AV_SAMPLE_FMT_S32:
      return 's32';
    case AV_SAMPLE_FMT_S32P:
      return 's32p';
    case AV_SAMPLE_FMT_FLTP:
      return 'fltp';
    case AV_SAMPLE_FMT_FLT:
    default:
      return 'flt';
  }
}
