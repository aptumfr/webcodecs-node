import { EventEmitter } from 'events';

import { Decoder, FilterAPI, HardwareContext } from 'node-av/api';
import { FormatContext, Packet, Stream, Rational } from 'node-av/lib';
import {
  AVMEDIA_TYPE_VIDEO,
  AV_PKT_FLAG_KEY,
  AV_CODEC_ID_H264,
  AV_CODEC_ID_HEVC,
  AV_CODEC_ID_VP8,
  AV_CODEC_ID_VP9,
  AV_CODEC_ID_AV1,
  AV_PIX_FMT_BGRA,
  AV_PIX_FMT_BGR0,
  AV_PIX_FMT_NV12,
  AV_PIX_FMT_RGBA,
  AV_PIX_FMT_RGB0,
  AV_PIX_FMT_YUV420P,
  AV_PIX_FMT_YUV422P,
  AV_PIX_FMT_YUV444P,
  AV_PIX_FMT_YUVA420P,
  type AVCodecID,
  type AVPixelFormat,
} from 'node-av/constants';

import type { DecoderConfig } from '../ffmpeg/types.js';
import { parseCodecString } from '../hardware/index.js';

type DecoderOptions = DecoderConfig & {
  description?: Buffer | Uint8Array;
  framerate?: number;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
};

/**
 * NodeAV-backed video decoder.
 *
 * Mirrors the FFmpegProcess decoder surface (startDecoder/write/end/kill)
 * so it can be swapped without touching callers.
 */
export class NodeAvVideoDecoder extends EventEmitter {
  private decoder: Decoder | null = null;
  private hardware: HardwareContext | null = null;
  private formatContext: FormatContext | null = null;
  private stream: Stream | null = null;
  private filter: FilterAPI | null = null;
  private config: DecoderOptions | null = null;
  private queue: Buffer[] = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private packetIndex = 0;
  private packetTimeBase: Rational = new Rational(1, 30);
  private outputPixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P;
  private filterDescription: string | null = null;
  private hardwarePreference: 'no-preference' | 'prefer-hardware' | 'prefer-software' = 'no-preference';

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startDecoder(config: DecoderOptions): void {
    this.config = { ...config };
    const framerate = config.framerate ?? 30;
    this.packetTimeBase = new Rational(1, framerate);
    this.outputPixelFormat = mapPixelFormat(config.outputPixelFormat ?? 'yuv420p');
    this.hardwarePreference = config.hardwareAcceleration ?? 'no-preference';
  }

  write(data: Buffer | Uint8Array): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }
    this.queue.push(Buffer.from(data));
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

    const codecName = parseCodecString(this.config.codec) ?? this.config.codec ?? 'h264';
    const codecId = mapCodecId(codecName);
    if (!codecId) {
      throw new Error(`Unsupported codec: ${this.config.codec}`);
    }

    this.formatContext = new FormatContext();
    this.formatContext.allocContext();
    this.stream = this.formatContext.newStream();
    this.stream.timeBase = this.packetTimeBase;

    const params = this.stream.codecpar;
    params.codecType = AVMEDIA_TYPE_VIDEO;
    params.codecId = codecId;
    params.width = this.config.width;
    params.height = this.config.height;
    if (this.config.description) {
      params.extradata = Buffer.from(this.config.description);
    }

    // Only try hardware if explicitly requested and not a known problematic codec
    const skipHardwareCodecs = ['vp9', 'av1']; // Known problematic HW decoders on some systems
    const shouldTryHardware =
      this.hardwarePreference === 'prefer-hardware' &&
      !skipHardwareCodecs.includes(codecName);

    if (shouldTryHardware) {
      try {
        this.hardware = HardwareContext.auto();
      } catch {
        this.hardware = null;
      }
    }

    this.decoder = await Decoder.create(this.stream, {
      hardware: this.hardware ?? undefined,
      exitOnError: true,
    });

    const hwName = this.hardware?.deviceTypeName;
    if (hwName && this.decoder.isHardware()) {
      console.log(`[NodeAvVideoDecoder] Using hardware decoder (${hwName})`);
    } else if (hwName) {
      console.log(`[NodeAvVideoDecoder] Hardware context ${hwName} unavailable, decoding in software`);
    } else if (this.hardwarePreference === 'prefer-hardware') {
      console.log('[NodeAvVideoDecoder] Hardware requested but not available, decoding in software');
    }
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
    if (this.packetIndex === 0) {
      // Cast to any to handle strict type checking on flags
      (packet as any).flags |= AV_PKT_FLAG_KEY;
    }

    await this.decoder.decode(packet);
    packet.unref();
    await this.drainFrames();
    this.packetIndex++;
  }

  private async drainFrames(): Promise<void> {
    if (!this.decoder) return;

    let frame = await this.decoder.receive();
    while (frame) {
      if (frame === undefined) {
        break;
      }
      const converted = await this.toOutputBuffer(frame);
      frame.unref();
      if (converted) {
        this.emit('frame', converted);
      }
      frame = await this.decoder.receive();
    }
  }

  private async toOutputBuffer(frame: any): Promise<Buffer | null> {
    const outputFormatName = pixelFormatToFFmpegName(this.outputPixelFormat);
    const isHardwareFrame = Boolean((frame as any).hwFramesCtx);

    // If frame already matches requested format and is software, just export
    if (!isHardwareFrame && frame.format === this.outputPixelFormat) {
      return frame.toBuffer();
    }

    const needsDownload = isHardwareFrame ? 'hwdownload,' : '';
    const description = `${needsDownload}format=${outputFormatName}`;

    if (!this.filter || this.filterDescription !== description) {
      this.filter?.close();
      // Use type assertion for FilterAPI options which may have additional properties
      this.filter = FilterAPI.create(description, {
        hardware: this.hardware ?? undefined,
      } as any);
      this.filterDescription = description;
    }

    await this.filter.process(frame);

    // Drain a single frame from the filter
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
    this.hardware?.dispose();
    this.hardware = null;
    this.formatContext = null;
    this.stream = null;
    this.queue = [];
  }
}

function mapCodecId(codec: string): AVCodecID | null {
  switch (codec.toLowerCase()) {
    case 'h264':
      return AV_CODEC_ID_H264;
    case 'hevc':
    case 'h265':
      return AV_CODEC_ID_HEVC;
    case 'vp8':
      return AV_CODEC_ID_VP8;
    case 'vp9':
      return AV_CODEC_ID_VP9;
    case 'av1':
      return AV_CODEC_ID_AV1;
    default:
      return null;
  }
}

function mapPixelFormat(format: string): AVPixelFormat {
  const fmt = format.toUpperCase();
  switch (fmt) {
    case 'I420':
    case 'YUV420P':
      return AV_PIX_FMT_YUV420P;
    case 'I420A':
    case 'YUVA420P':
      return AV_PIX_FMT_YUVA420P;
    case 'I422':
    case 'YUV422P':
      return AV_PIX_FMT_YUV422P;
    case 'I444':
    case 'YUV444P':
      return AV_PIX_FMT_YUV444P;
    case 'NV12':
      return AV_PIX_FMT_NV12;
    case 'BGRA':
      return AV_PIX_FMT_BGRA;
    case 'BGRX':
      return AV_PIX_FMT_BGR0;
    case 'RGBA':
      return AV_PIX_FMT_RGBA;
    case 'RGBX':
      return AV_PIX_FMT_RGB0;
    default:
      return AV_PIX_FMT_YUV420P;
  }
}

function pixelFormatToFFmpegName(fmt: AVPixelFormat): string {
  switch (fmt) {
    case AV_PIX_FMT_BGRA:
      return 'bgra';
    case AV_PIX_FMT_BGR0:
      return 'bgr0';
    case AV_PIX_FMT_RGBA:
      return 'rgba';
    case AV_PIX_FMT_RGB0:
      return 'rgb0';
    case AV_PIX_FMT_NV12:
      return 'nv12';
    case AV_PIX_FMT_YUV422P:
      return 'yuv422p';
    case AV_PIX_FMT_YUV444P:
      return 'yuv444p';
    case AV_PIX_FMT_YUVA420P:
      return 'yuva420p';
    case AV_PIX_FMT_YUV420P:
    default:
      return 'yuv420p';
  }
}
