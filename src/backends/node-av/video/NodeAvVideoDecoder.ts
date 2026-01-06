/**
 * NodeAvVideoDecoder - Video decoder using node-av native bindings
 *
 * Implements the VideoDecoderBackend interface for decoding video streams
 * using FFmpeg's libav* libraries via node-av.
 */

import { EventEmitter } from 'events';

import { Decoder, FilterAPI, HardwareContext } from 'node-av/api';
import { FormatContext, Packet, Stream, Rational } from 'node-av/lib';
import {
  AVMEDIA_TYPE_VIDEO,
  AV_PKT_FLAG_KEY,
  AV_PIX_FMT_YUV420P,
  type AVPixelFormat,
} from 'node-av/constants';

import type {
  VideoDecoderBackend,
  VideoDecoderBackendConfig,
  DecodedFrame,
} from '../../types.js';
import type { VideoColorSpaceInit } from '../../../formats/color-space.js';
import { extractColorSpaceFromFrame } from '../../../formats/color-space.js';
import { DEFAULT_FRAMERATE } from '../../types.js';
import { parseCodecString } from '../../../hardware/index.js';
import { createLogger } from '../../../utils/logger.js';
import { selectBestFilterChain, getNextFilterChain, describePipeline } from '../HardwarePipeline.js';
import { acquireHardwareContext, releaseHardwareContext } from '../../../utils/hardware-pool.js';
import {
  MAX_FILTER_CHAIN_ATTEMPTS,
  SKIP_HARDWARE_CODECS,
  mapCodecId,
  mapPixelFormat,
  pixelFormatToFFmpegName,
} from './decoder/index.js';

const logger = createLogger('NodeAvVideoDecoder');

/**
 * NodeAV-backed video decoder implementing VideoDecoderBackend interface
 */
export class NodeAvVideoDecoder extends EventEmitter implements VideoDecoderBackend {
  private decoder: Decoder | null = null;
  private hardware: HardwareContext | null = null;
  private formatContext: FormatContext | null = null;
  private stream: Stream | null = null;
  private filter: FilterAPI | null = null;
  private config: VideoDecoderBackendConfig | null = null;
  private queue: Array<{ data: Buffer; timestamp: number; duration: number }> = [];
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private packetIndex = 0;
  // Use microsecond timebase to preserve input timestamps exactly
  private packetTimeBase: Rational = new Rational(1, 1_000_000);
  private outputPixelFormat: AVPixelFormat = AV_PIX_FMT_YUV420P;
  private filterDescription: string | null = null;
  private hardwarePreference: 'no-preference' | 'prefer-hardware' | 'prefer-software' = 'no-preference';
  // Track input timestamps - sorted by presentation order (ascending)
  // Used to recover timestamps since node-av decoder doesn't preserve packet PTS
  private pendingTimestamps: number[] = [];

  get isHealthy(): boolean {
    return !this.shuttingDown;
  }

  startDecoder(config: VideoDecoderBackendConfig): void {
    this.config = { ...config };
    // Use microsecond timebase for timestamp preservation (set in constructor)
    this.outputPixelFormat = mapPixelFormat(config.outputPixelFormat ?? 'yuv420p');
    this.hardwarePreference = config.hardwareAcceleration ?? 'no-preference';
  }

  write(data: Buffer | Uint8Array, timestamp?: number, duration?: number): boolean {
    if (!this.config || this.shuttingDown) {
      return false;
    }
    const ts = timestamp ?? 0;
    this.queue.push({ data: Buffer.from(data), timestamp: ts, duration: duration ?? 0 });
    // Insert timestamp into sorted pending list (ascending order = display order)
    // Binary search to find insertion point
    let lo = 0, hi = this.pendingTimestamps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.pendingTimestamps[mid] < ts) lo = mid + 1;
      else hi = mid;
    }
    this.pendingTimestamps.splice(lo, 0, ts);
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
          const item = this.queue.shift()!;
          // Emit chunkAccepted when chunk starts processing (for dequeue event)
          // Use setImmediate to ensure emit happens after write() returns
          setImmediate(() => this.emit('chunkAccepted'));
          await this.decodeBuffer(item.data, item.timestamp, item.duration);
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
    // Width/height can be 0 for size-less configs - FFmpeg will determine from bitstream
    params.width = this.config.width ?? 0;
    params.height = this.config.height ?? 0;
    if (this.config.description) {
      params.extradata = Buffer.from(this.config.description);
    }

    // Try hardware decoding unless explicitly disabled or codec is on skip list
    // 'no-preference' and 'prefer-hardware' both enable hardware acceleration
    // 'prefer-software' disables hardware acceleration
    const shouldTryHardware =
      this.hardwarePreference !== 'prefer-software' &&
      !SKIP_HARDWARE_CODECS.includes(codecName);

    if (shouldTryHardware) {
      // Use pooled hardware context instead of creating new one
      this.hardware = acquireHardwareContext();
    }

    this.decoder = await Decoder.create(this.stream, {
      hardware: this.hardware ?? undefined,
      exitOnError: true,
    });

    this.logDecoderSelection(codecName);
  }

  private logDecoderSelection(codecName: string): void {
    const hwName = this.hardware?.deviceTypeName;
    if (hwName && this.decoder?.isHardware()) {
      logger.info(`Using hardware decoder (${hwName}) for ${codecName}`);
    } else if (hwName) {
      logger.info(`Hardware context ${hwName} unavailable, decoding in software`);
    } else if (this.hardwarePreference === 'prefer-hardware') {
      logger.info('Hardware requested but not available, decoding in software');
    } else {
      logger.debug(`Using software decoder for ${codecName}`);
    }
  }

  private async decodeBuffer(buffer: Buffer, timestamp: number, duration: number): Promise<void> {
    await this.ensureDecoder();
    if (!this.decoder || !this.stream) {
      throw new Error('Decoder not initialized');
    }

    const packet = new Packet();
    packet.alloc();
    packet.streamIndex = this.stream.index;
    // Use input timestamp as PTS (in microseconds, matching our timebase)
    packet.pts = BigInt(Math.round(timestamp));
    packet.dts = BigInt(Math.round(timestamp));
    packet.timeBase = this.packetTimeBase;
    packet.data = buffer;
    // Use actual duration from chunk (in microseconds), fallback to 1 if not provided
    packet.duration = duration > 0 ? BigInt(Math.round(duration)) : 1n;
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
      // The node-av decoder doesn't preserve packet PTS in output frames.
      // Frames come out in display order (lowest PTS first), so we pop
      // from our sorted timestamp list to recover the original timestamp.
      const timestamp = this.pendingTimestamps.shift() ?? 0;

      // Extract colorSpace from the native frame BEFORE filtering
      // (filtering destroys color info as it converts to target format)
      const colorSpace = extractColorSpaceFromFrame({
        colorPrimaries: (frame as any).colorPrimaries,
        colorTrc: (frame as any).colorTrc,
        colorSpace: (frame as any).colorSpace,
        colorRange: (frame as any).colorRange,
      });

      const output = await this.toOutput(frame);
      if (!output.nativeFrame) {
        frame.unref();
      }
      if (output.buffer) {
        this.emit('frame', { buffer: output.buffer, timestamp, colorSpace });
      } else if (output.nativeFrame) {
        this.emit('frame', { nativeFrame: output.nativeFrame, format: this.outputPixelFormat, timestamp, colorSpace });
      }
      frame = await this.decoder.receive();
    }
  }

  private async toOutput(frame: any): Promise<{ buffer: Buffer | null; nativeFrame?: any }> {
    const outputFormatName = pixelFormatToFFmpegName(this.outputPixelFormat);
    const isHardwareFrame = Boolean((frame as any).hwFramesCtx);

    // If frame already matches requested format and is software, just export
    if (!isHardwareFrame && frame.format === this.outputPixelFormat) {
      // Keep frame alive for the caller; they are responsible for unref()
      return { buffer: null, nativeFrame: frame };
    }

    // Try to process with current or new filter chain
    // If it fails, automatically try the next chain in the fallback sequence
    let attempts = 0;

    while (attempts < MAX_FILTER_CHAIN_ATTEMPTS) {
      attempts++;

      // Get filter chain (either current or select new one)
      let description: string;
      if (!this.filter || this.filterDescription === null) {
        description = selectBestFilterChain(this.hardware, outputFormatName, isHardwareFrame);
      } else {
        description = this.filterDescription;
      }

      // Create filter if needed
      if (!this.filter || this.filterDescription !== description) {
        this.filter?.close();

        // Log the selected pipeline
        const hwType = this.hardware?.deviceTypeName ?? 'software';
        logger.debug(`Pipeline: ${describePipeline(description, hwType)}`);

        try {
          this.filter = FilterAPI.create(description, {
            hardware: this.hardware ?? undefined,
          } as any);
          this.filterDescription = description;
        } catch (err) {
          // Filter creation failed, try next chain
          logger.debug('Filter creation failed, trying next chain...');
          this.filter = null;
          this.filterDescription = null;
          const nextChain = getNextFilterChain(this.hardware, outputFormatName, isHardwareFrame);
          if (!nextChain) {
            throw err; // No more chains to try
          }
          continue;
        }
      }

      // Try to process the frame
      try {
        await this.filter.process(frame);

        // Drain a single frame from the filter
        let filtered = await this.filter.receive();
        while (filtered === null) {
          filtered = await this.filter.receive();
        }
        if (!filtered) {
          return { buffer: null };
        }

        const buffer = filtered.toBuffer();
        filtered.unref();
        return { buffer };
      } catch (err) {
        // Processing failed - close filter and try next chain
        logger.debug(`Filter processing failed: ${err instanceof Error ? err.message : err}`);
        this.filter?.close();
        this.filter = null;
        this.filterDescription = null;

        const nextChain = getNextFilterChain(this.hardware, outputFormatName, isHardwareFrame);
        if (!nextChain) {
          throw err; // No more chains to try
        }
        // Loop will continue with next chain
      }
    }

    throw new Error(`Failed to find working filter chain after ${MAX_FILTER_CHAIN_ATTEMPTS} attempts`);
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
    // Release hardware context back to pool for reuse
    releaseHardwareContext(this.hardware);
    this.hardware = null;
    this.formatContext = null;
    this.stream = null;
    this.queue = [];
    this.pendingTimestamps = [];
  }
}
