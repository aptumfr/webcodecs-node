/**
 * NodeAvVideoEncoder - Video encoder using node-av native bindings
 *
 * Implements the VideoEncoderBackend interface for encoding video frames
 * using FFmpeg's libav* libraries via node-av.
 */

import { EventEmitter } from 'events';

import { Encoder, FilterAPI, HardwareContext } from 'node-av/api';
import { Frame, Rational } from 'node-av/lib';
import {
  AV_PIX_FMT_BGRA,
  AV_PIX_FMT_NV12,
  AV_PIX_FMT_RGBA,
  AV_PIX_FMT_YUV420P,
  AV_PIX_FMT_YUVA420P,
  AV_PIX_FMT_YUV420P10LE,
  AV_PIX_FMT_YUV422P10LE,
  AV_PIX_FMT_YUV444P10LE,
  AV_PIX_FMT_P010LE,
  type AVPixelFormat,
  type FFEncoderCodec,
  AV_PKT_FLAG_KEY,
} from 'node-av/constants';

import type {
  VideoEncoderBackend,
  VideoEncoderBackendConfig,
  EncodedFrame,
} from '../backends/types.js';
import {
  DEFAULT_FRAMERATE,
  DEFAULT_VP_BITRATE,
  CRF_DEFAULTS,
} from '../backends/types.js';
import { parseCodecString, getBestEncoderSync } from '../hardware/index.js';
import { createLogger } from '../utils/logger.js';
import {
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
} from '../utils/hevc.js';
import {
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
  convertAnnexBToAvcc,
} from '../utils/avc.js';
import { acquireHardwareContext, releaseHardwareContext } from '../utils/hardware-pool.js';
import { getQualityConfig } from '../config/webcodecs-config.js';

// Import from video-encoder submodule
import {
  mapPixelFormat,
  getSoftwareEncoder,
  getHardwareMinResolution,
  buildGpuFilterChain,
} from './video-encoder/index.js';

const logger = createLogger('NodeAvVideoEncoder');

/**
 * NodeAV-backed video encoder implementing VideoEncoderBackend interface
 */
export class NodeAvVideoEncoder extends EventEmitter implements VideoEncoderBackend {
  private encoder: Encoder | null = null;
  private hardware: HardwareContext | null = null;
  private filter: FilterAPI | null = null;
  private config: VideoEncoderBackendConfig | null = null;
  private frameIndex = 0;
  private queue: Array<{ buffer?: Buffer; frame?: Frame; owned?: boolean; timestamp: number }> = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private inputPixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P;
  private encoderPixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P;
  private timeBase: Rational = new Rational(1, DEFAULT_FRAMERATE);
  private codecDescription: Buffer | null = null;
  private isHevcCodec = false;
  private isAvcCodec = false;
  private needsFormatConversion = false;
  private needsRescaling = false;
  private outputFormat: 'annexb' | 'mp4' = 'mp4'; // Default to MP4/AVCC format

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startEncoder(config: VideoEncoderBackendConfig): void {
    this.config = { ...config };
    // Use microsecond timebase to preserve input timestamps exactly
    this.timeBase = new Rational(1, 1_000_000);
    this.inputPixelFormat = mapPixelFormat(config.inputPixelFormat || 'yuv420p');
    this.outputFormat = config.format ?? 'mp4'; // Default to MP4/AVCC format

    // Log HDR metadata presence - full wiring to FFmpeg codec context requires node-av API additions
    if (config.colorSpace?.hdrMetadata) {
      logger.info(`HDR metadata provided (primaries=${config.colorSpace.primaries}, transfer=${config.colorSpace.transfer})`);
      logger.warn('HDR side data (mastering display, content light level) not yet wired to encoder context');
    }
  }

  write(data: Buffer | Uint8Array, timestamp?: number): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    this.queue.push({ buffer: Buffer.from(data), owned: true, timestamp: timestamp ?? 0 });
    void this.processQueue();
    return true;
  }

  writeFrame(frame: Frame, timestamp?: number): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    this.queue.push({ frame, owned: false, timestamp: timestamp ?? 0 });
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────────

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
          // Emit frameAccepted when frame starts processing (for dequeue event)
          // Use setImmediate to ensure emit happens after write() returns
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

    const codecName = parseCodecString(this.config.codec) ?? 'h264';
    this.isHevcCodec = codecName === 'hevc';
    this.isAvcCodec = codecName === 'h264';
    const framerate = this.config.framerate ?? DEFAULT_FRAMERATE;
    const gopSize = Math.max(1, framerate);

    // SVT-AV1 derives framerate from timebase, so we must use framerate-based timebase
    // instead of microseconds to avoid "maximum allowed frame rate is 240 fps" error
    if (codecName === 'av1') {
      this.timeBase = new Rational(1, framerate);
    }

    const { encoderCodec, isHardware } = await this.selectEncoderCodec(codecName);
    const options = this.buildEncoderOptions(codecName, framerate, gopSize);

    this.configurePixelFormat(isHardware, options, codecName);

    logger.debug(`Encoder options: ${JSON.stringify(options.options)}, bitrate=${options.bitrate}`);

    try {
      this.encoder = await Encoder.create(encoderCodec, options);
      logger.info(`Created encoder: ${encoderCodec}`);
    } catch (hwErr) {
      if (isHardware) {
        logger.warn(`Hardware encoder failed, falling back to software: ${(hwErr as Error).message}`);
        releaseHardwareContext(this.hardware);
        this.hardware = null;

        const softwareCodec = getSoftwareEncoder(codecName);
        this.encoderPixelFormat = AV_PIX_FMT_YUV420P;
        options.pixelFormat = AV_PIX_FMT_YUV420P;
        options.hardware = undefined;
        this.encoder = await Encoder.create(softwareCodec as FFEncoderCodec, options);
        logger.info(`Using software encoder: ${softwareCodec}`);
      } else {
        throw hwErr;
      }
    }
  }

  private configurePixelFormat(
    isHardware: boolean,
    options: Record<string, any>,
    codecName: string
  ): void {
    // Check if input has alpha and user wants to keep it
    const inputHasAlpha = this.inputPixelFormat === AV_PIX_FMT_YUVA420P ||
                          this.inputPixelFormat === AV_PIX_FMT_RGBA ||
                          this.inputPixelFormat === AV_PIX_FMT_BGRA;
    const keepAlpha = this.config?.alpha === 'keep' && inputHasAlpha;

    // Check if input is 10-bit
    const inputIs10Bit = this.inputPixelFormat === AV_PIX_FMT_YUV420P10LE ||
                         this.inputPixelFormat === AV_PIX_FMT_YUV422P10LE ||
                         this.inputPixelFormat === AV_PIX_FMT_YUV444P10LE ||
                         this.inputPixelFormat === AV_PIX_FMT_P010LE;

    // Only VP9 supports alpha encoding (via YUVA420P) in software
    // libsvtav1 doesn't support alpha pixel formats
    // Hardware encoders don't support alpha
    const codecSupportsAlpha = codecName === 'vp9' && !isHardware;

    // HEVC, VP9 and AV1 support 10-bit encoding
    const codecSupports10Bit = codecName === 'hevc' || codecName === 'vp9' || codecName === 'av1';

    if (keepAlpha && codecSupportsAlpha) {
      this.encoderPixelFormat = AV_PIX_FMT_YUVA420P;
      options.pixelFormat = AV_PIX_FMT_YUVA420P;
      logger.debug(`Alpha channel will be preserved (codec: ${codecName})`);
    } else if (inputIs10Bit && codecSupports10Bit && !isHardware) {
      // Use 10-bit encoding for software encoders
      // Note: Currently all 10-bit inputs (I422P10, I444P10) are downconverted to 4:2:0
      // because most software encoders default to 4:2:0 chroma subsampling
      this.encoderPixelFormat = AV_PIX_FMT_YUV420P10LE;
      options.pixelFormat = AV_PIX_FMT_YUV420P10LE;
      logger.debug(`10-bit encoding enabled (codec: ${codecName})`);

      // Warn if chroma subsampling is being changed (422/444 → 420)
      if (this.inputPixelFormat === AV_PIX_FMT_YUV422P10LE) {
        logger.warn(`10-bit 4:2:2 (I422P10) input will be downconverted to 4:2:0 (I420P10) - chroma resolution reduced`);
      } else if (this.inputPixelFormat === AV_PIX_FMT_YUV444P10LE) {
        logger.warn(`10-bit 4:4:4 (I444P10) input will be downconverted to 4:2:0 (I420P10) - chroma resolution reduced`);
      }

      if (keepAlpha) {
        logger.warn(`Alpha requested with 10-bit input but 10-bit alpha not supported - discarding alpha`);
      }
    } else if (inputIs10Bit && isHardware) {
      // Hardware 10-bit: use P010 (semi-planar 10-bit)
      this.encoderPixelFormat = AV_PIX_FMT_P010LE;
      options.pixelFormat = AV_PIX_FMT_P010LE;
      logger.debug(`Hardware 10-bit encoding using P010`);
      if (keepAlpha) {
        logger.warn(`Alpha requested but hardware encoders don't support alpha - discarding`);
      }
    } else if (isHardware) {
      this.encoderPixelFormat = AV_PIX_FMT_NV12;
      options.pixelFormat = AV_PIX_FMT_NV12;
      if (keepAlpha) {
        logger.warn(`Alpha requested but hardware encoders don't support alpha - discarding`);
      }
    } else {
      this.encoderPixelFormat = AV_PIX_FMT_YUV420P;
      options.pixelFormat = AV_PIX_FMT_YUV420P;
      if (keepAlpha) {
        logger.warn(`Alpha requested but ${codecName} doesn't support alpha - discarding`);
      }
      if (inputIs10Bit) {
        logger.warn(`10-bit input but ${codecName} doesn't support 10-bit - downconverting to 8-bit`);
      }
    }

    // Check if format conversion is needed
    this.needsFormatConversion = this.inputPixelFormat !== this.encoderPixelFormat;

    // Check if rescaling is needed (input dimensions differ from output dimensions)
    const inputWidth = this.config!.inputWidth ?? this.config!.width;
    const inputHeight = this.config!.inputHeight ?? this.config!.height;
    this.needsRescaling = inputWidth !== this.config!.width || inputHeight !== this.config!.height;

    // Build filter chain if format conversion or rescaling is needed
    if (this.needsFormatConversion || this.needsRescaling) {
      let targetFormat: string;
      if (this.encoderPixelFormat === AV_PIX_FMT_NV12) {
        targetFormat = 'nv12';
      } else if (this.encoderPixelFormat === AV_PIX_FMT_YUVA420P) {
        targetFormat = 'yuva420p';
      } else if (this.encoderPixelFormat === AV_PIX_FMT_YUV420P10LE) {
        targetFormat = 'yuv420p10le';
      } else if (this.encoderPixelFormat === AV_PIX_FMT_P010LE) {
        targetFormat = 'p010le';
      } else {
        targetFormat = 'yuv420p';
      }

      // Build filter string with optional scale and format conversion
      const filterParts: string[] = [];
      if (this.needsRescaling) {
        // Use lanczos scaling for high quality
        filterParts.push(`scale=${this.config!.width}:${this.config!.height}:flags=lanczos`);
        logger.debug(`Rescaling: ${inputWidth}x${inputHeight} → ${this.config!.width}x${this.config!.height}`);
      }
      if (this.needsFormatConversion) {
        filterParts.push(`format=${targetFormat}`);
      }

      // Try GPU-accelerated filter if hardware context is available
      if (this.hardware) {
        const hwType = this.hardware.deviceTypeName;
        const gpuFilter = buildGpuFilterChain(hwType, targetFormat, inputWidth, inputHeight, this.config!.width, this.config!.height);

        if (gpuFilter) {
          try {
            this.filter = FilterAPI.create(gpuFilter, {
              hardware: this.hardware,
            } as any);
            logger.debug(`Created GPU filter chain (${hwType}): ${gpuFilter}`);
            return;
          } catch (err) {
            logger.debug(`GPU filter failed, falling back to CPU: ${(err as Error).message}`);
          }
        }
      }

      // Fallback: CPU filter chain via libswscale
      const filterChain = filterParts.join(',');
      this.filter = FilterAPI.create(filterChain);
      logger.debug(`Created CPU filter chain: ${filterChain}`);
    }
  }

  private async selectEncoderCodec(codecName: string): Promise<{ encoderCodec: any; isHardware: boolean }> {
    const hwPref = this.config?.hardwareAcceleration;
    const width = this.config?.width ?? 0;
    const height = this.config?.height ?? 0;

    // Use the unified hardware detection system which respects webcodecs-config.js
    const bestEncoder = getBestEncoderSync(codecName as any, hwPref);

    if (bestEncoder.isHardware && bestEncoder.hwaccel) {
      // Check if resolution meets hardware encoder minimum requirements
      // VAAPI/QSV have known minimum constraints that vary by codec
      const minSize = getHardwareMinResolution(bestEncoder.hwaccel, codecName);
      if (width < minSize.width || height < minSize.height) {
        logger.info(`Resolution ${width}x${height} below hardware minimum ${minSize.width}x${minSize.height}, using software encoder`);
      } else {
        try {
          // Use pooled hardware context
          this.hardware = acquireHardwareContext(bestEncoder.hwaccel);
          if (this.hardware) {
            const hwCodec = this.hardware.getEncoderCodec(codecName as any);
            if (hwCodec) {
              logger.info(`Using hardware encoder: ${bestEncoder.encoder} (${this.hardware.deviceTypeName})`);
              return { encoderCodec: hwCodec, isHardware: true };
            }
          }
        } catch {
          releaseHardwareContext(this.hardware);
          this.hardware = null;
        }
        // Fall through to software if hardware failed
        logger.warn(`Hardware encoder ${bestEncoder.encoder} failed, falling back to software`);
      }
    }

    const softwareCodec = getSoftwareEncoder(codecName);
    logger.info(`Using software encoder: ${softwareCodec}`);
    return { encoderCodec: softwareCodec as FFEncoderCodec, isHardware: false };
  }

  private buildEncoderOptions(codecName: string, framerate: number, gopSize: number): Record<string, any> {
    const options: Record<string, string | number> = {};
    const isVpCodec = codecName === 'vp8' || codecName === 'vp9';
    const isAv1 = codecName === 'av1';
    const hwType = this.hardware?.deviceTypeName;
    const qualityOverrides = getQualityConfig(codecName);

    // Codec-specific options
    if (isVpCodec) {
      this.configureVpxOptions(options);
    } else if (isAv1) {
      this.configureSvtAv1Options(options);
    } else {
      this.configureX26xOptions(options, hwType);
    }

    // Quality mode
    if (qualityOverrides.crf !== undefined) {
      options.crf = String(qualityOverrides.crf);
    } else if (this.config?.bitrateMode === 'quantizer') {
      const crf = CRF_DEFAULTS[codecName as keyof typeof CRF_DEFAULTS];
      if (crf) {
        options.crf = String(crf);
      }
    }

    // Explicit preset overrides codec defaults when supported
    // Note: Different encoders use different preset names:
    // - x264/x265: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
    // - NVENC: p1-p7 (or fast, medium, slow)
    // - QSV: veryfast, faster, fast, medium, slow, slower, veryslow
    // We only apply user preset if no hardware (software encoder) to avoid compatibility issues
    if (qualityOverrides.preset && !hwType) {
      options.preset = qualityOverrides.preset;
    }

    // Bitrate (required for VP/AV1)
    let bitrate = this.config?.bitrate;
    if (!bitrate && (isVpCodec || isAv1)) {
      bitrate = DEFAULT_VP_BITRATE;
    }

    return {
      type: 'video' as const,
      width: this.config!.width,
      height: this.config!.height,
      pixelFormat: this.inputPixelFormat,
      timeBase: this.timeBase,
      frameRate: new Rational(framerate, 1),
      bitrate,
      gopSize,
      maxBFrames: this.config?.latencyMode === 'realtime' ? 0 : undefined,
      hardware: this.hardware ?? undefined,
      options,
    };
  }

  private configureVpxOptions(options: Record<string, string | number>): void {
    if (this.config?.latencyMode === 'realtime') {
      options.deadline = 'realtime';
      options['cpu-used'] = '8';
      options['lag-in-frames'] = '0';
    } else {
      options.deadline = 'good';
      options['cpu-used'] = '4';
    }
  }

  private configureSvtAv1Options(options: Record<string, string | number>): void {
    if (this.config?.latencyMode === 'realtime') {
      options.preset = '10';
    } else {
      options.preset = '6';
    }

    // Apply AV1-specific options from config
    if (this.config?.av1?.forceScreenContentTools) {
      // Enable screen content tools for better compression of screen content
      // This enables palette mode and intra block copy which are useful for screen sharing
      options['enable-screen-content-mode'] = '1';
    }
  }

  private configureX26xOptions(options: Record<string, string | number>, hwType?: string): void {
    if (this.config?.latencyMode === 'realtime') {
      if (hwType === 'cuda') {
        // NVENC presets: p1 (fastest) to p7 (slowest), or 'fast'/'medium'/'slow'
        options.preset = 'p1';
      } else if (hwType === 'qsv') {
        options.preset = 'veryfast';
      } else if (hwType === 'vaapi') {
        // VAAPI: lower quality = faster encoding, low QP for better quality
        options.quality = '0';
      } else if (!hwType) {
        // Software x264/x265
        options.preset = 'ultrafast';
      }
    } else {
      if (hwType === 'cuda') {
        // NVENC: p4 is a good balance
        options.preset = 'p4';
      } else if (hwType === 'qsv') {
        options.preset = 'medium';
      } else if (hwType === 'vaapi') {
        // VAAPI: higher quality setting
        options.quality = '4';
      } else if (!hwType) {
        // Software x264/x265
        options.preset = 'medium';
      }
    }

    // Configure rate control based on hardware type and bitrate mode
    const bitrate = this.config?.bitrate;
    if (bitrate && this.config?.bitrateMode !== 'quantizer') {
      if (hwType === 'vaapi') {
        // VAAPI: Use CQP mode with low QP for high quality
        // Note: node-av doesn't properly pass bitrate to VAAPI, so we use quality-based encoding
        // QP 20 gives good quality (lower = higher quality, range 0-51)
        options.qp = 20;
      } else if (hwType === 'cuda') {
        // NVENC: Use VBR mode
        options.rc = 'vbr';
      } else if (hwType === 'qsv') {
        // QSV: Use VBR mode
        options.preset = options.preset ?? 'medium';
      } else {
        // Software x264/x265: Set VBV maxrate and bufsize for proper bitrate control
        // bufsize = 2x bitrate gives ~2 second buffer, good for streaming
        options.maxrate = String(bitrate);
        options.bufsize = String(bitrate * 2);
      }
    }
  }

  private async encodeBuffer(buffer: Buffer, timestamp: number): Promise<void> {
    await this.ensureEncoder();
    if (!this.encoder || !this.config) {
      throw new Error('Encoder not initialized');
    }

    const frame = await this.createFrame(buffer, true);
    // Convert input timestamp (microseconds) to encoder timebase
    // For most codecs, timebase is 1/1000000 so pts = timestamp
    // For AV1/SVT-AV1, timebase is 1/framerate so pts = timestamp * framerate / 1000000
    const pts = BigInt(Math.round(timestamp * this.timeBase.den / 1_000_000));
    frame.pts = pts;

    await this.encoder.encode(frame);
    frame.unref();

    await this.drainPackets();
    this.frameIndex++;
  }

  private async encodeFrame(inputFrame: Frame, owned: boolean, timestamp: number): Promise<void> {
    await this.ensureEncoder();
    if (!this.encoder || !this.config) {
      throw new Error('Encoder not initialized');
    }

    const frame = await this.createFrame(inputFrame, owned);
    // Convert input timestamp (microseconds) to encoder timebase
    const pts = BigInt(Math.round(timestamp * this.timeBase.den / 1_000_000));
    frame.pts = pts;

    await this.encoder.encode(frame);
    if (owned || frame !== inputFrame) {
      frame.unref();
    }

    await this.drainPackets();
    this.frameIndex++;
  }

  private async createFrame(source: Buffer | Frame, ownInput: boolean): Promise<Frame> {
    // Use input dimensions for buffer frames (they may differ from output dimensions)
    const inputWidth = this.config!.inputWidth ?? this.config!.width;
    const inputHeight = this.config!.inputHeight ?? this.config!.height;

    const inputFrame = source instanceof Frame
      ? source
      : Frame.fromVideoBuffer(source, {
        width: inputWidth,
        height: inputHeight,
        format: this.inputPixelFormat,
        timeBase: this.timeBase,
      });

    // Use filter for format conversion and/or rescaling
    if ((!this.needsFormatConversion && !this.needsRescaling) || !this.filter) {
      return inputFrame;
    }

    try {
      await this.filter.process(inputFrame);
      if (ownInput) {
        inputFrame.unref();
      }

      const convertedFrame = await this.filter.receive();
      if (!convertedFrame) {
        throw new Error('Format conversion failed: no output from filter');
      }

      return convertedFrame;
    } catch (err) {
      // GPU filter failed - fall back to CPU SIMD filter
      logger.warn(`Filter processing failed, falling back to CPU: ${(err as Error).message}`);
      if (ownInput) {
        inputFrame.unref();
      }

      // Close failed filter and create CPU fallback with scale and/or format conversion
      this.filter.close();
      const targetFormat = this.encoderPixelFormat === AV_PIX_FMT_NV12 ? 'nv12' :
                          this.encoderPixelFormat === AV_PIX_FMT_YUVA420P ? 'yuva420p' : 'yuv420p';
      const filterParts: string[] = [];
      if (this.needsRescaling) {
        filterParts.push(`scale=${this.config!.width}:${this.config!.height}:flags=lanczos`);
      }
      if (this.needsFormatConversion) {
        filterParts.push(`format=${targetFormat}`);
      }
      const fallbackChain = filterParts.join(',');
      this.filter = FilterAPI.create(fallbackChain);
      logger.debug(`Created CPU fallback filter: ${fallbackChain}`);

      const retryFrame = source instanceof Frame
        ? source
        : Frame.fromVideoBuffer(source, {
          width: inputWidth,
          height: inputHeight,
          format: this.inputPixelFormat,
          timeBase: this.timeBase,
        });

      await this.filter.process(retryFrame);
      if (ownInput || retryFrame !== source) {
        retryFrame.unref();
      }

      const convertedFrame = await this.filter.receive();
      if (!convertedFrame) {
        throw new Error('CPU filter processing failed: no output from filter');
      }

      return convertedFrame;
    }
  }

  private async drainPackets(): Promise<void> {
    if (!this.encoder) return;

    let packet = await this.encoder.receive();
    while (packet) {
      if (packet.data) {
        // Convert packet PTS from packet's timebase to microseconds
        // timestamp_us = pts * (timeBase.num / timeBase.den) * 1_000_000
        let timestamp = this.frameIndex;
        if (packet.pts !== undefined) {
          const tb = packet.timeBase;
          const ptsUs = (packet.pts * BigInt(tb.num) * 1_000_000n) / BigInt(tb.den);
          timestamp = Number(ptsUs);
        }
        const keyFrame = (packet.flags & AV_PKT_FLAG_KEY) === AV_PKT_FLAG_KEY || packet.isKeyframe;

        // For H.264/HEVC, extract parameter sets from first keyframe and build description
        // Also convert Annex B (start codes) to length-prefixed format for MP4 compatibility
        let frameData: Buffer = Buffer.from(packet.data);

        // H.264: Extract SPS/PPS and build AVCC description
        if (this.isAvcCodec && keyFrame && !this.codecDescription) {
          try {
            const { sps, pps } = extractAvcParameterSetsFromAnnexB(packet.data);
            if (sps.length > 0 && pps.length > 0) {
              this.codecDescription = Buffer.from(buildAvcDecoderConfig(sps, pps, 4));
              logger.debug(`Built AVCC description: ${this.codecDescription.length} bytes`);
            } else {
              logger.warn('H.264 keyframe missing parameter sets (SPS/PPS)');
            }
          } catch (err) {
            logger.warn(`Failed to extract H.264 parameter sets: ${(err as Error).message}`);
          }
        }

        // HEVC: Extract VPS/SPS/PPS and build HVCC description
        if (this.isHevcCodec && keyFrame && !this.codecDescription) {
          try {
            const { vps, sps, pps } = extractHevcParameterSetsFromAnnexB(packet.data);
            if (vps.length > 0 && sps.length > 0 && pps.length > 0) {
              this.codecDescription = Buffer.from(buildHvccDecoderConfig(vps, sps, pps, 4));
              logger.debug(`Built HVCC description: ${this.codecDescription.length} bytes`);
            } else {
              logger.warn('HEVC keyframe missing parameter sets (VPS/SPS/PPS)');
            }
          } catch (err) {
            logger.warn(`Failed to extract HEVC parameter sets: ${(err as Error).message}`);
          }
        }

        // Convert H.264/HEVC Annex B to length-prefixed format only when format is 'mp4'
        // When format is 'annexb', preserve the raw Annex B output with start codes
        if (this.outputFormat !== 'annexb') {
          if (this.isAvcCodec) {
            frameData = convertAnnexBToAvcc(packet.data, 4);
            logger.debug(`Converted H.264 frame to length-prefixed: ${packet.data.length} -> ${frameData.length} bytes`);
          }

          if (this.isHevcCodec) {
            frameData = convertAnnexBToHvcc(packet.data, 4);
            logger.debug(`Converted HEVC frame to length-prefixed: ${packet.data.length} -> ${frameData.length} bytes`);
          }
        }

        const frame: EncodedFrame = {
          data: frameData,
          timestamp,
          keyFrame,
          description: this.codecDescription ?? undefined,
        };

        logger.debug(`Encoded packet: size=${packet.data.length}, key=${keyFrame}`);
        this.emit('encodedFrame', frame);
      }
      packet.unref();
      packet = await this.encoder.receive();
    }
  }

  private async finish(): Promise<void> {
    await this.processQueue();
    if (this.processingPromise) {
      await this.processingPromise;
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

  private cleanup(): void {
    this.filter?.close();
    this.filter = null;
    this.encoder?.close();
    this.encoder = null;
    // Release hardware context back to pool for reuse
    releaseHardwareContext(this.hardware);
    this.hardware = null;
    this.queue = [];
  }
}
