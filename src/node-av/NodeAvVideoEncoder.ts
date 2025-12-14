import { EventEmitter } from 'events';

import { Encoder, HardwareContext } from 'node-av/api';
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
  private config: EncoderOptions | null = null;
  private frameIndex = 0;
  private queue: Buffer[] = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private pixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P;
  private encoderPixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P; // Format encoder expects
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
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
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
        this.processingPromise = null;
      }
    })();

    return this.processingPromise;
  }

  private async ensureEncoder(): Promise<void> {
    if (this.encoder || !this.config) {
      return;
    }

    const codecName = parseCodecString(this.config.codec) ?? 'h264';
    const framerate = this.config.framerate ?? 30;
    const gopSize = Math.max(1, framerate);

    const { encoderCodec, isHardware } = await this.selectEncoderCodec(codecName);
    const options = this.buildEncoderOptions(codecName, framerate, gopSize);

    // Determine encoder pixel format based on input format and whether hardware is used
    const isRgba = this.pixelFormat === AV_PIX_FMT_RGBA || this.pixelFormat === AV_PIX_FMT_BGRA;
    const isNv12Input = this.pixelFormat === AV_PIX_FMT_NV12;

    if (isHardware) {
      // Hardware encoders typically require NV12
      this.encoderPixelFormat = AV_PIX_FMT_NV12;
      options.pixelFormat = AV_PIX_FMT_NV12;
      if (isRgba) {
        console.log('[NodeAvVideoEncoder] Converting RGBA input to NV12 for hardware encoder');
      } else if (!isNv12Input) {
        console.log('[NodeAvVideoEncoder] Converting input to NV12 for hardware encoder');
      }
    } else {
      // Software encoders typically use YUV420P
      this.encoderPixelFormat = AV_PIX_FMT_YUV420P;
      options.pixelFormat = AV_PIX_FMT_YUV420P;
      if (isRgba) {
        console.log('[NodeAvVideoEncoder] Converting RGBA input to I420 for software encoder');
      } else if (isNv12Input) {
        console.log('[NodeAvVideoEncoder] Converting NV12 input to I420 for software encoder');
      }
    }

    try {
      this.encoder = await Encoder.create(encoderCodec, options);
    } catch (hwErr) {
      // If hardware encoder fails, try software fallback
      if (isHardware) {
        console.log(`[NodeAvVideoEncoder] Hardware encoder failed, falling back to software: ${(hwErr as Error).message}`);
        this.hardware?.dispose();
        this.hardware = null;

        const softwareCodec = this.getSoftwareEncoder(codecName);
        this.encoderPixelFormat = AV_PIX_FMT_YUV420P;
        options.pixelFormat = AV_PIX_FMT_YUV420P;
        options.hardware = undefined;
        this.encoder = await Encoder.create(softwareCodec as FFEncoderCodec, options);
      } else {
        throw hwErr;
      }
    }
  }

  private getSoftwareEncoder(codecName: string): string {
    switch (codecName) {
      case 'h264': return 'libx264';
      case 'hevc': return 'libx265';
      case 'vp8': return 'libvpx';
      case 'vp9': return 'libvpx-vp9';
      case 'av1': return 'libsvtav1';
      default: return codecName;
    }
  }

  private async selectEncoderCodec(codecName: string): Promise<{ encoderCodec: any; isHardware: boolean }> {
    // Check if hardware acceleration is requested (default to no-preference for stability)
    const hwPref = (this.config as any)?.hardwareAcceleration as
      | 'prefer-hardware'
      | 'prefer-software'
      | 'no-preference'
      | undefined;

    // Only try hardware if explicitly requested
    // QSV VP9/AV1 encoders are known to have issues, so skip them
    const skipHardwareCodecs = ['vp9', 'av1']; // Known problematic HW encoders
    const shouldTryHardware = hwPref === 'prefer-hardware' && !skipHardwareCodecs.includes(codecName);

    if (shouldTryHardware) {
      try {
        this.hardware = HardwareContext.auto();
        if (this.hardware) {
          const hwCodec = this.hardware.getEncoderCodec(codecName as any);
          if (hwCodec) {
            console.log(
              `[NodeAvVideoEncoder] Using hardware encoder ${hwCodec.name ?? hwCodec} (${this.hardware.deviceTypeName})`
            );
            return { encoderCodec: hwCodec, isHardware: true };
          }
        }
      } catch {
        // Ignore hardware failures; fall back to software
        this.hardware?.dispose();
        this.hardware = null;
      }
    }

    // Software encoder - use actual FFmpeg encoder names (with hyphens where needed)
    const softwareCodec = this.getSoftwareEncoder(codecName);
    console.log(`[NodeAvVideoEncoder] Using software encoder ${softwareCodec}`);
    return { encoderCodec: softwareCodec as FFEncoderCodec, isHardware: false };
  }

  private buildEncoderOptions(codecName: string, framerate: number, gopSize: number) {
    const options: Record<string, string | number> = {};
    const isVpCodec = codecName === 'vp8' || codecName === 'vp9';
    const isAv1 = codecName === 'av1';

    // Latency and bitrate hints (hardware-safe defaults)
    const hwType = this.hardware?.deviceTypeName;

    // VP8/VP9/AV1 use different options than x264/x265
    if (isVpCodec) {
      // libvpx options
      if (this.config?.latencyMode === 'realtime') {
        options.deadline = 'realtime';
        options['cpu-used'] = '8';
        options['lag-in-frames'] = '0';
      } else {
        options.deadline = 'good';
        options['cpu-used'] = '4';
      }
    } else if (isAv1) {
      // libsvtav1 options (different from libaom-av1)
      // SVT-AV1 uses 'preset' (0-13, lower = better quality, slower)
      if (this.config?.latencyMode === 'realtime') {
        options.preset = '10'; // Fast preset for realtime
      } else {
        options.preset = '6'; // Balanced preset
      }
    } else {
      // x264/x265 options
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
    }

    if (this.config?.bitrateMode === 'quantizer') {
      // Rough CRF defaults
      if (codecName === 'h264' || codecName === 'hevc') {
        options.crf = '23';
      } else if (isVpCodec) {
        options.crf = '31';
      } else if (isAv1) {
        options.crf = '30';
      }
    }

    // VP8/VP9/AV1 require bitrate to be set for proper encoding
    // Use default if not specified
    let bitrate = this.config?.bitrate;
    if (!bitrate && (isVpCodec || isAv1)) {
      bitrate = 500_000; // Default 500kbps for VP/AV1
    }

    return {
      type: 'video' as const,
      width: this.config!.width,
      height: this.config!.height,
      pixelFormat: this.pixelFormat,
      timeBase: this.timeBase,
      frameRate: new Rational(framerate, 1),
      bitrate,
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

    let frame: Frame;

    // Convert input to format encoder expects
    if (this.pixelFormat === AV_PIX_FMT_RGBA || this.pixelFormat === AV_PIX_FMT_BGRA) {
      // RGBA/BGRA input - convert to encoder format
      let convertedData: Uint8Array;
      if (this.encoderPixelFormat === AV_PIX_FMT_NV12) {
        convertedData = convertRgbaToNv12(buffer, this.config.width, this.config.height);
      } else {
        convertedData = convertRgbaToI420(buffer, this.config.width, this.config.height);
      }
      frame = Frame.fromVideoBuffer(Buffer.from(convertedData), {
        width: this.config.width,
        height: this.config.height,
        format: this.encoderPixelFormat,
        timeBase: this.timeBase,
      });
    } else if (this.pixelFormat === AV_PIX_FMT_NV12 && this.encoderPixelFormat === AV_PIX_FMT_YUV420P) {
      // NV12 input but encoder expects I420 - convert
      const convertedData = convertNv12ToI420(buffer, this.config.width, this.config.height);
      frame = Frame.fromVideoBuffer(Buffer.from(convertedData), {
        width: this.config.width,
        height: this.config.height,
        format: AV_PIX_FMT_YUV420P,
        timeBase: this.timeBase,
      });
    } else {
      // Direct pass-through (I420 input to I420 encoder, etc.)
      frame = Frame.fromVideoBuffer(buffer, {
        width: this.config.width,
        height: this.config.height,
        format: this.pixelFormat,
        timeBase: this.timeBase,
      });
    }
    frame.pts = BigInt(this.frameIndex);

    await this.encoder.encode(frame);
    frame.unref();

    let packet = await this.encoder.receive();
    while (packet) {
      if (packet.data) {
        const timestamp = packet.pts !== undefined ? Number(packet.pts) : this.frameIndex;
        const keyFrame = (packet.flags & AV_PKT_FLAG_KEY) === AV_PKT_FLAG_KEY || packet.isKeyframe;
        console.log(`[NodeAvVideoEncoder] Emitting packet size=${packet.data.length}, key=${keyFrame}`);
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

  private async finish(): Promise<void> {
    // Drain pending work (wait for any in-flight processing)
    await this.processQueue();
    if (this.processingPromise) {
      await this.processingPromise;
    }

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
      return AV_PIX_FMT_RGBA;
    default:
      return AV_PIX_FMT_YUV420P;
  }
}

function convertRgbaToI420(rgba: Buffer | Uint8Array, width: number, height: number): Uint8Array {
  const ySize = width * height;
  const uvSize = (width / 2) * (height / 2);
  const out = new Uint8Array(ySize + 2 * uvSize);
  const yPlane = out.subarray(0, ySize);
  const uPlane = out.subarray(ySize, ySize + uvSize);
  const vPlane = out.subarray(ySize + uvSize);

  for (let j = 0; j < height; j += 2) {
    for (let i = 0; i < width; i += 2) {
      let uSum = 0;
      let vSum = 0;

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = i + dx;
          const y = j + dy;
          const idx = (y * width + x) * 4;
          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];

          const yVal = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
          yPlane[y * width + x] = clampByte(yVal);

          const uVal = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
          const vVal = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
          uSum += uVal;
          vSum += vVal;
        }
      }

      uPlane[(j / 2) * (width / 2) + i / 2] = clampByte(uSum >> 2);
      vPlane[(j / 2) * (width / 2) + i / 2] = clampByte(vSum >> 2);
    }
  }

  return out;
}

function clampByte(val: number): number {
  return Math.max(0, Math.min(255, val));
}

/**
 * Convert NV12 (Y + interleaved UV) to I420 (Y + U + V planar)
 */
function convertNv12ToI420(nv12: Buffer | Uint8Array, width: number, height: number): Uint8Array {
  const ySize = width * height;
  const uvWidth = width / 2;
  const uvHeight = height / 2;
  const uvPlaneSize = uvWidth * uvHeight;
  const uvInterleavedSize = uvPlaneSize * 2;

  const out = new Uint8Array(ySize + 2 * uvPlaneSize);
  const yPlane = out.subarray(0, ySize);
  const uPlane = out.subarray(ySize, ySize + uvPlaneSize);
  const vPlane = out.subarray(ySize + uvPlaneSize);

  // Copy Y plane directly
  yPlane.set(nv12.subarray(0, ySize));

  // De-interleave UV plane
  const uvInterleaved = nv12.subarray(ySize, ySize + uvInterleavedSize);
  for (let i = 0; i < uvPlaneSize; i++) {
    uPlane[i] = uvInterleaved[i * 2];
    vPlane[i] = uvInterleaved[i * 2 + 1];
  }

  return out;
}

/**
 * Convert RGBA to NV12 (Y plane followed by interleaved UV plane)
 * NV12 is: Y plane (width*height) + UV plane interleaved (width*height/2)
 */
function convertRgbaToNv12(rgba: Buffer | Uint8Array, width: number, height: number): Uint8Array {
  const ySize = width * height;
  const uvSize = (width / 2) * (height / 2) * 2; // Interleaved UV
  const out = new Uint8Array(ySize + uvSize);
  const yPlane = out.subarray(0, ySize);
  const uvPlane = out.subarray(ySize);

  for (let j = 0; j < height; j += 2) {
    for (let i = 0; i < width; i += 2) {
      let uSum = 0;
      let vSum = 0;

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = i + dx;
          const y = j + dy;
          const idx = (y * width + x) * 4;

          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];

          // BT.601 coefficients
          const yVal = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
          yPlane[y * width + x] = clampByte(yVal);

          const uVal = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
          const vVal = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
          uSum += uVal;
          vSum += vVal;
        }
      }

      // NV12 has interleaved UV: UVUVUV...
      const uvIdx = (j / 2) * width + i; // UV row is width bytes (interleaved pairs)
      uvPlane[uvIdx] = clampByte(uSum >> 2);     // U
      uvPlane[uvIdx + 1] = clampByte(vSum >> 2); // V
    }
  }

  return out;
}
