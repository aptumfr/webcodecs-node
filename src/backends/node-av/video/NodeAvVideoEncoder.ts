/**
 * NodeAvVideoEncoder - Video encoder using node-av native bindings
 *
 * Implements the VideoEncoderBackend interface for encoding video frames
 * using FFmpeg's libav* libraries via node-av.
 */

import { EventEmitter } from 'events';

import { Encoder, FilterAPI, type HardwareContext } from 'node-av/api';
import { Frame, Rational } from 'node-av/lib';
import {
  AV_PIX_FMT_YUV420P,
  type AVPixelFormat,
  AV_PICTURE_TYPE_I,
} from 'node-av/constants';

import type {
  VideoEncoderBackend,
  VideoEncoderBackendConfig,
} from '../../types.js';
import { DEFAULT_FRAMERATE } from '../../types.js';
import { parseCodecString } from '../../../hardware/index.js';
import { createLogger } from '../../../utils/logger.js';
import { releaseHardwareContext } from '../../../utils/hardware-pool.js';

// Import from encoder submodule
import {
  mapPixelFormat,
  getSoftwareEncoder,
  buildEncoderOptions,
  microsecondsToPts,
  getCodecTimeBase,
  selectEncoderCodec,
  fallbackToSoftware,
  configureEncoderPixelFormat,
  createEncoderFilter,
  createCpuFallbackFilter,
  drainEncoderPackets,
  type FilterConfig,
} from './encoder/index.js';

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
  private queue: Array<{ buffer?: Buffer; frame?: Frame; owned?: boolean; timestamp: number; keyFrame?: boolean }> = [];
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
  private outputFormat: 'annexb' | 'mp4' = 'mp4';
  private targetFormatName = 'yuv420p';

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startEncoder(config: VideoEncoderBackendConfig): void {
    this.config = { ...config };
    this.inputPixelFormat = mapPixelFormat(config.inputPixelFormat || 'yuv420p');
    this.outputFormat = config.format ?? 'mp4';

    // Log HDR metadata presence
    if (config.colorSpace?.hdrMetadata) {
      logger.info(`HDR metadata provided (primaries=${config.colorSpace.primaries}, transfer=${config.colorSpace.transfer})`);
      logger.warn('HDR side data (mastering display, content light level) not yet wired to encoder context');
    }
  }

  write(data: Buffer | Uint8Array, timestamp?: number, keyFrame?: boolean): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.queue.push({ buffer, owned: true, timestamp: timestamp ?? 0, keyFrame });
    void this.processQueue();
    return true;
  }

  writeFrame(frame: Frame, timestamp?: number, keyFrame?: boolean): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }

    this.queue.push({ frame, owned: false, timestamp: timestamp ?? 0, keyFrame });
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
          setImmediate(() => this.emit('frameAccepted'));
          if (item.frame) {
            await this.encodeFrame(item.frame, item.owned ?? true, item.timestamp, item.keyFrame);
          } else if (item.buffer) {
            await this.encodeBuffer(item.buffer, item.timestamp, item.keyFrame);
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

    // Get appropriate timebase for codec
    this.timeBase = getCodecTimeBase(codecName, framerate, Rational);

    // Select encoder codec (hardware or software)
    const selection = await selectEncoderCodec(
      codecName,
      this.config.width,
      this.config.height,
      this.config.hardwareAcceleration
    );
    this.hardware = selection.hardware;

    // Configure pixel format based on input and codec capabilities
    const inputHasAlpha = this.config.alpha === 'keep';
    const pixelConfig = configureEncoderPixelFormat(
      this.inputPixelFormat,
      codecName,
      selection.isHardware,
      inputHasAlpha
    );
    this.encoderPixelFormat = pixelConfig.encoderPixelFormat;
    this.needsFormatConversion = pixelConfig.needsFormatConversion;
    this.targetFormatName = pixelConfig.targetFormatName;

    // Check if rescaling is needed
    const inputWidth = this.config.inputWidth ?? this.config.width;
    const inputHeight = this.config.inputHeight ?? this.config.height;
    this.needsRescaling = inputWidth !== this.config.width || inputHeight !== this.config.height;

    // Build encoder options
    const options = buildEncoderOptions(
      this.config,
      codecName,
      this.inputPixelFormat,
      this.timeBase,
      this.hardware
    );
    options.pixelFormat = this.encoderPixelFormat;

    // Create filter chain if needed
    if (this.needsFormatConversion || this.needsRescaling) {
      const filterConfig: FilterConfig = {
        targetFormat: this.targetFormatName,
        inputWidth,
        inputHeight,
        outputWidth: this.config.width,
        outputHeight: this.config.height,
        needsRescaling: this.needsRescaling,
        needsFormatConversion: this.needsFormatConversion,
      };
      this.filter = createEncoderFilter(filterConfig, this.hardware);
    }

    logger.debug(`Encoder options: ${JSON.stringify(options.options)}, bitrate=${options.bitrate}`);

    try {
      this.encoder = await Encoder.create(selection.encoderCodec, options);
      logger.info(`Created encoder: ${selection.encoderCodec}`);
    } catch (hwErr) {
      if (selection.isHardware) {
        logger.warn(`Hardware encoder failed, falling back to software: ${(hwErr as Error).message}`);
        const fallback = fallbackToSoftware(codecName, this.hardware);
        this.hardware = fallback.hardware;

        this.encoderPixelFormat = AV_PIX_FMT_YUV420P;
        options.pixelFormat = AV_PIX_FMT_YUV420P;
        options.hardware = undefined;
        this.encoder = await Encoder.create(fallback.encoderCodec, options);
        logger.info(`Using software encoder: ${fallback.encoderCodec}`);
      } else {
        throw hwErr;
      }
    }
  }

  private async encodeBuffer(buffer: Buffer, timestamp: number, keyFrame?: boolean): Promise<void> {
    await this.ensureEncoder();
    if (!this.encoder || !this.config) {
      throw new Error('Encoder not initialized');
    }

    const frame = await this.createFrame(buffer, true);
    frame.pts = microsecondsToPts(timestamp, this.timeBase);

    if (keyFrame) {
      frame.pictType = AV_PICTURE_TYPE_I;
    }

    await this.encoder.encode(frame);
    frame.unref();

    await this.drainPackets();
    this.frameIndex++;
  }

  private async encodeFrame(inputFrame: Frame, owned: boolean, timestamp: number, keyFrame?: boolean): Promise<void> {
    await this.ensureEncoder();
    if (!this.encoder || !this.config) {
      throw new Error('Encoder not initialized');
    }

    const frame = await this.createFrame(inputFrame, owned);
    frame.pts = microsecondsToPts(timestamp, this.timeBase);

    if (keyFrame) {
      frame.pictType = AV_PICTURE_TYPE_I;
    }

    await this.encoder.encode(frame);
    if (owned || frame !== inputFrame) {
      frame.unref();
    }

    await this.drainPackets();
    this.frameIndex++;
  }

  private async createFrame(source: Buffer | Frame, ownInput: boolean): Promise<Frame> {
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
      logger.warn(`Filter processing failed, falling back to CPU: ${(err as Error).message}`);
      if (ownInput) {
        inputFrame.unref();
      }

      // Create CPU fallback filter
      this.filter.close();
      const filterConfig: FilterConfig = {
        targetFormat: this.targetFormatName,
        inputWidth,
        inputHeight,
        outputWidth: this.config!.width,
        outputHeight: this.config!.height,
        needsRescaling: this.needsRescaling,
        needsFormatConversion: this.needsFormatConversion,
      };
      this.filter = createCpuFallbackFilter(filterConfig);

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

    const result = await drainEncoderPackets(this.encoder, {
      codecDescription: this.codecDescription,
      isAvcCodec: this.isAvcCodec,
      isHevcCodec: this.isHevcCodec,
      outputFormat: this.outputFormat,
      frameIndex: this.frameIndex,
    });

    // Update codec description if extracted
    if (result.codecDescription) {
      this.codecDescription = result.codecDescription;
    }

    // Emit all encoded frames
    for (const frame of result.frames) {
      this.emit('encodedFrame', frame);
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
    releaseHardwareContext(this.hardware);
    this.hardware = null;
    this.queue = [];
  }
}
