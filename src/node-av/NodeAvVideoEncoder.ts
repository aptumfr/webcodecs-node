import { EventEmitter } from 'events';

import { Encoder, HardwareContext, FilterAPI } from 'node-av/api';
import { Frame, Rational } from 'node-av/lib';
import {
  AV_PIX_FMT_BGRA,
  AV_PIX_FMT_NV12,
  AV_PIX_FMT_RGBA,
  AV_PIX_FMT_YUV420P,
  AV_PIX_FMT_YUV422P,
  AV_PIX_FMT_YUV444P,
  AV_PIX_FMT_YUVA420P,
  type AVPixelFormat,
  type AVCodecID,
  type FFEncoderCodec,
  AV_PKT_FLAG_KEY,
  FF_ENCODER_LIBAOM_AV1,
  FF_ENCODER_LIBVPX_VP8,
  FF_ENCODER_LIBVPX_VP9,
  FF_ENCODER_LIBX264,
  FF_ENCODER_LIBX265,
} from 'node-av/constants';

import type { EncoderConfig } from '../ffmpeg/types.js';
import type { BitrateMode } from '../ffmpeg/types.js';
import { parseCodecString } from '../hardware/index.js';

type EncoderOptions = EncoderConfig & { latencyMode?: 'quality' | 'realtime'; bitrateMode?: BitrateMode };

/**
 * NodeAV-backed video encoder.
 *
 * Exposes the same surface the existing FFmpegProcess encoder uses so it can be
 * swapped in without touching callers. Work is queued internally and processed
 * asynchronously; write() remains sync and returns a boolean to match the
 * FFmpegProcess contract.
 */
export class NodeAvVideoEncoder extends EventEmitter {
  private encoder: Encoder | null = null;
  private hardware: HardwareContext | null = null;
  private filter: FilterAPI | null = null;
  private config: EncoderOptions | null = null;
  private frameIndex = 0;
  private queue: Buffer[] = [];
  private processing = false;
  private shuttingDown = false;
  private pixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P;
  private timeBase: Rational = new Rational(1, 30);

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  /**
   * Match FFmpegProcess.startEncoder signature.
   * Creation of the underlying node-av encoder is deferred until the first write.
   */
  startEncoder(config: EncoderOptions): void {
    this.config = { ...config };
    const framerate = config.framerate ?? 30;
    this.timeBase = new Rational(1, framerate);
    this.pixelFormat = mapPixelFormat(config.inputPixelFormat || 'yuv420p');
  }

  /**
   * Match FFmpegProcess.write signature: enqueue work and return true/false.
   */
  write(data: Buffer | Uint8Array): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    this.queue.push(Buffer.from(data));
    // Fire and forget processing; errors surface via 'error' event
    void this.processQueue();
    return true;
  }

  /**
   * Signal end-of-stream; flush remaining packets and emit 'close'.
   */
  end(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    void this.finish().catch((err) => this.emit('error', err));
  }

  /**
   * Match FFmpegProcess.kill: stop immediately.
   */
  kill(): void {
    this.shuttingDown = true;
    this.cleanup();
    this.emit('close', null);
  }

  /**
   * Graceful shutdown with timeout compatibility.
   */
  async shutdown(): Promise<void> {
    this.end();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const data = this.queue.shift()!;
        await this.encodeBuffer(data);
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.processing = false;
    }
  }

  private async ensureEncoder(): Promise<void> {
    if (this.encoder || !this.config) {
      return;
    }

    const codecName = parseCodecString(this.config.codec) ?? 'h264';
    const framerate = this.config.framerate ?? 30;
    const gopSize = Math.max(1, framerate);

    const encoderCodec = await this.selectEncoderCodec(codecName);
    const options = this.buildEncoderOptions(codecName, framerate, gopSize);

    // Insert format conversion filter if needed (e.g., RGBA -> NV12)
    const needsConversion = this.pixelFormat === AV_PIX_FMT_RGBA || this.pixelFormat === AV_PIX_FMT_BGRA;
    if (needsConversion) {
      this.filter = FilterAPI.create('format=nv12', {});
      options.pixelFormat = AV_PIX_FMT_NV12;
      console.log('[NodeAvVideoEncoder] Converting input to NV12 for encoder');
    }

    this.encoder = await Encoder.create(encoderCodec, options);
  }

  private async selectEncoderCodec(codecName: string): Promise<any> {
    // Try hardware first
    try {
      this.hardware = HardwareContext.auto();
      if (this.hardware) {
        const hwCodec = this.hardware.getEncoderCodec(codecName as any);
        if (hwCodec) {
          console.log(
            `[NodeAvVideoEncoder] Using hardware encoder ${hwCodec.name ?? hwCodec} (${this.hardware.deviceTypeName})`
          );
          return hwCodec;
        }
      }
    } catch {
      // Ignore hardware failures; fall back to software
      this.hardware?.dispose();
      this.hardware = null;
    }

    // Software fallback
    switch (codecName) {
      case 'h264':
        console.log('[NodeAvVideoEncoder] Falling back to software encoder libx264');
        return FF_ENCODER_LIBX264;
      case 'hevc':
        console.log('[NodeAvVideoEncoder] Falling back to software encoder libx265');
        return FF_ENCODER_LIBX265;
      case 'vp8':
        console.log('[NodeAvVideoEncoder] Falling back to software encoder libvpx_vp8');
        return FF_ENCODER_LIBVPX_VP8;
      case 'vp9':
        console.log('[NodeAvVideoEncoder] Falling back to software encoder libvpx_vp9');
        return FF_ENCODER_LIBVPX_VP9;
      case 'av1':
        console.log('[NodeAvVideoEncoder] Falling back to software encoder libaom-av1');
        return FF_ENCODER_LIBAOM_AV1;
      default:
        return codecName as FFEncoderCodec;
    }
  }

  private buildEncoderOptions(codecName: string, framerate: number, gopSize: number) {
    const options: Record<string, string | number> = {};

    // Latency and bitrate hints (hardware-safe defaults)
    const hwType = this.hardware?.deviceTypeName;
    if (this.config?.latencyMode === 'realtime') {
      if (hwType === 'qsv') {
        options.preset = 'veryfast';
      } else if (!hwType) {
        options.preset = 'ultrafast';
      }
    } else {
      if (hwType === 'qsv') {
        options.preset = 'medium';
      } else if (!hwType) {
        options.preset = 'medium';
      }
    }

    if (this.config?.bitrateMode === 'quantizer') {
      // Rough CRF defaults
      if (codecName === 'h264' || codecName === 'hevc') {
        options.crf = '23';
      } else if (codecName === 'av1') {
        options.cq_level = '30';
      }
    }

    return {
      type: 'video' as const,
      width: this.config!.width,
      height: this.config!.height,
      pixelFormat: this.pixelFormat,
      timeBase: this.timeBase,
      frameRate: new Rational(framerate, 1),
      bitrate: this.config?.bitrate,
      gopSize,
      maxBFrames: this.config?.latencyMode === 'realtime' ? 0 : undefined,
      hardware: this.hardware ?? undefined,
      options,
    };
  }

  private async encodeBuffer(buffer: Buffer): Promise<void> {
    await this.ensureEncoder();
    if (!this.encoder || !this.config) {
      throw new Error('Encoder not initialized');
    }

    const inputFrame = Frame.fromVideoBuffer(buffer, {
      width: this.config.width,
      height: this.config.height,
      format: this.pixelFormat,
      timeBase: this.timeBase,
    });
    inputFrame.pts = BigInt(this.frameIndex);

    const framesToEncode: Frame[] = [];

    if (this.filter) {
      // Convert to encoder-friendly format
      const filtered = await this.filter.processAll(inputFrame);
      inputFrame.unref();
      if (filtered && filtered.length > 0) {
        framesToEncode.push(...filtered);
      }
    } else {
      framesToEncode.push(inputFrame);
    }

    for (const frame of framesToEncode) {
      await this.encoder.encode(frame);
      frame.unref();

      let packet = await this.encoder.receive();
      while (packet) {
        if (packet.data) {
          const timestamp = packet.pts !== undefined ? Number(packet.pts) : this.frameIndex;
          const keyFrame = (packet.flags & AV_PKT_FLAG_KEY) === AV_PKT_FLAG_KEY || packet.isKeyframe;
          this.emit('encodedFrame', {
            data: Buffer.from(packet.data),
            timestamp,
            keyFrame,
          });
        }
        packet.unref();
        packet = await this.encoder.receive();
      }

      this.frameIndex++;
    }
  }

  private async finish(): Promise<void> {
    // Drain pending work
    await this.processQueue();

    if (this.encoder) {
      try {
        await this.encoder.flush();
        let packet = await this.encoder.receive();
        while (packet) {
          if (packet.data) {
            const timestamp = packet.pts !== undefined ? Number(packet.pts) : this.frameIndex;
            const keyFrame = (packet.flags & AV_PKT_FLAG_KEY) === AV_PKT_FLAG_KEY || packet.isKeyframe;
            this.emit('encodedFrame', {
              data: Buffer.from(packet.data),
              timestamp,
              keyFrame,
            });
          }
          packet.unref();
          packet = await this.encoder.receive();
        }
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
    this.encoder?.close();
    this.encoder = null;
    this.hardware?.dispose();
    this.hardware = null;
    this.queue = [];
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
    case 'RGBA':
    default:
      return AV_PIX_FMT_RGBA;
  }
}
