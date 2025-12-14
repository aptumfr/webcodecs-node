/**
 * NodeAvImageDecoder - Node-av based image decoder
 *
 * Decodes still images and animated images (GIF, APNG, WebP) using node-av
 * native bindings instead of spawning FFmpeg CLI processes.
 */

import { Decoder, FilterAPI } from 'node-av/api';
import { FormatContext, Packet, Stream, Rational } from 'node-av/lib';
import {
  AVMEDIA_TYPE_VIDEO,
  AV_CODEC_ID_PNG,
  AV_CODEC_ID_MJPEG,
  AV_CODEC_ID_WEBP,
  AV_CODEC_ID_GIF,
  AV_CODEC_ID_BMP,
  AV_CODEC_ID_TIFF,
  AV_CODEC_ID_AV1,
  type AVCodecID,
} from 'node-av/constants';

import type { VideoColorSpaceInit } from '../formats/index.js';

export interface DecodedImageFrame {
  data: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
  duration: number;
  complete: boolean;
  colorSpace?: VideoColorSpaceInit;
}

export interface ImageDecoderConfig {
  mimeType: string;
  data: Uint8Array;
  desiredWidth?: number;
  desiredHeight?: number;
  colorSpace?: VideoColorSpaceInit;
}

// MIME type to AVCodecID mapping
const MIME_TO_CODEC_ID: Record<string, AVCodecID> = {
  'image/png': AV_CODEC_ID_PNG,
  'image/apng': AV_CODEC_ID_PNG,
  'image/jpeg': AV_CODEC_ID_MJPEG,
  'image/jpg': AV_CODEC_ID_MJPEG,
  'image/webp': AV_CODEC_ID_WEBP,
  'image/gif': AV_CODEC_ID_GIF,
  'image/bmp': AV_CODEC_ID_BMP,
  'image/tiff': AV_CODEC_ID_TIFF,
  'image/avif': AV_CODEC_ID_AV1,
};

/**
 * Decode images using node-av native bindings
 */
export class NodeAvImageDecoder {
  private decoder: Decoder | null = null;
  private formatContext: FormatContext | null = null;
  private stream: Stream | null = null;
  private filter: FilterAPI | null = null;
  private config: ImageDecoderConfig;
  private frames: DecodedImageFrame[] = [];
  private closed = false;

  // Use a dummy time_base for still images (required by node-av)
  private static readonly DUMMY_TIME_BASE = new Rational(1, 25);
  private static readonly DEFAULT_FRAME_DURATION = 100000; // 100ms in microseconds

  constructor(config: ImageDecoderConfig) {
    this.config = config;
  }

  /**
   * Decode all frames from the image data
   */
  async decode(): Promise<DecodedImageFrame[]> {
    if (this.closed) {
      throw new Error('Decoder is closed');
    }

    const codecId = this.getCodecId();
    if (!codecId) {
      throw new Error(`Unsupported image type: ${this.config.mimeType}`);
    }

    try {
      await this.initializeDecoder(codecId);
      await this.decodeData();
      await this.flush();
    } finally {
      this.cleanup();
    }

    return this.frames;
  }

  /**
   * Get the codec ID for the MIME type
   */
  private getCodecId(): AVCodecID | null {
    return MIME_TO_CODEC_ID[this.config.mimeType.toLowerCase()] ?? null;
  }

  /**
   * Initialize the decoder with the given codec
   */
  private async initializeDecoder(codecId: AVCodecID): Promise<void> {
    this.formatContext = new FormatContext();
    this.formatContext.allocContext();
    this.stream = this.formatContext.newStream();
    this.stream.timeBase = NodeAvImageDecoder.DUMMY_TIME_BASE;

    const params = this.stream.codecpar;
    params.codecType = AVMEDIA_TYPE_VIDEO;
    params.codecId = codecId;
    // Width/height will be detected from the image data
    params.width = 0;
    params.height = 0;

    this.decoder = await Decoder.create(this.stream, {
      exitOnError: false,
    });
  }

  /**
   * Decode the image data
   */
  private async decodeData(): Promise<void> {
    if (!this.decoder || !this.stream) {
      throw new Error('Decoder not initialized');
    }

    const data = this.config.data;
    const isAnimated = this.isAnimatedFormat();

    if (isAnimated) {
      // For animated formats, we need to parse frame boundaries
      // For now, send all data as one packet and let decoder handle it
      await this.sendPacket(Buffer.from(data), 0);
    } else {
      // For still images, send the entire buffer as one packet
      await this.sendPacket(Buffer.from(data), 0);
    }

    await this.drainFrames();
  }

  /**
   * Check if this is an animated format
   */
  private isAnimatedFormat(): boolean {
    const type = this.config.mimeType.toLowerCase();
    return ['image/gif', 'image/apng', 'image/webp'].includes(type);
  }

  /**
   * Send a packet to the decoder
   */
  private async sendPacket(data: Buffer, pts: number): Promise<void> {
    if (!this.decoder || !this.stream) return;

    const packet = new Packet();
    packet.alloc();
    packet.streamIndex = this.stream.index;
    packet.pts = BigInt(pts);
    packet.dts = BigInt(pts);
    packet.timeBase = NodeAvImageDecoder.DUMMY_TIME_BASE;
    packet.data = data;
    packet.duration = 1n;

    await this.decoder.decode(packet);
    packet.unref();
  }

  /**
   * Drain decoded frames from the decoder
   */
  private async drainFrames(): Promise<void> {
    if (!this.decoder) return;

    let frame = await this.decoder.receive();
    while (frame) {
      const converted = await this.convertFrame(frame);
      frame.unref();

      if (converted) {
        this.frames.push(converted);
      }

      frame = await this.decoder.receive();
    }
  }

  /**
   * Convert a decoded frame to RGBA
   */
  private async convertFrame(frame: any): Promise<DecodedImageFrame | null> {
    const width = frame.width;
    const height = frame.height;

    if (width === 0 || height === 0) {
      return null;
    }

    // Build filter description for scaling and format conversion
    let filterDesc = '';
    if (this.config.desiredWidth || this.config.desiredHeight) {
      const scaleW = this.config.desiredWidth || -1;
      const scaleH = this.config.desiredHeight || -1;
      filterDesc = `scale=${scaleW}:${scaleH},format=rgba`;
    } else {
      filterDesc = 'format=rgba';
    }

    // Create or reuse filter
    if (!this.filter) {
      this.filter = FilterAPI.create(filterDesc, {});
    }

    await this.filter.process(frame);

    let filtered = await this.filter.receive();
    // Keep trying until we get a frame (filter might buffer)
    let attempts = 0;
    while (filtered === null && attempts < 10) {
      filtered = await this.filter.receive();
      attempts++;
    }

    if (!filtered) {
      return null;
    }

    const outputWidth = this.config.desiredWidth || width;
    const outputHeight = this.config.desiredHeight || height;
    const buffer = filtered.toBuffer();
    filtered.unref();

    const timestamp = this.frames.length * NodeAvImageDecoder.DEFAULT_FRAME_DURATION;
    const duration = this.isAnimatedFormat() ? NodeAvImageDecoder.DEFAULT_FRAME_DURATION : 0;

    return {
      data: new Uint8Array(buffer),
      width: outputWidth,
      height: outputHeight,
      timestamp,
      duration,
      complete: true,
      colorSpace: this.config.colorSpace,
    };
  }

  /**
   * Flush the decoder to get any remaining frames
   */
  private async flush(): Promise<void> {
    if (!this.decoder) return;

    try {
      await this.decoder.flush();
      await this.drainFrames();
    } catch {
      // Ignore flush errors
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.filter?.close();
    this.filter = null;
    this.decoder?.close();
    this.decoder = null;
    this.formatContext = null;
    this.stream = null;
  }

  /**
   * Close the decoder
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cleanup();
    this.frames = [];
  }

  /**
   * Check if a MIME type is supported
   */
  static isTypeSupported(mimeType: string): boolean {
    return mimeType.toLowerCase() in MIME_TO_CODEC_ID;
  }
}

/**
 * Probe image dimensions using node-av
 * Returns { width, height } or { width: 0, height: 0 } if probing fails
 */
export async function probeImageDimensions(
  data: Uint8Array,
  mimeType: string
): Promise<{ width: number; height: number }> {
  const codecId = MIME_TO_CODEC_ID[mimeType.toLowerCase()];
  if (!codecId) {
    return { width: 0, height: 0 };
  }

  let formatContext: FormatContext | null = null;
  let stream: Stream | null = null;
  let decoder: Decoder | null = null;

  try {
    formatContext = new FormatContext();
    formatContext.allocContext();
    stream = formatContext.newStream();
    stream.timeBase = new Rational(1, 25);

    const params = stream.codecpar;
    params.codecType = AVMEDIA_TYPE_VIDEO;
    params.codecId = codecId;
    params.width = 0;
    params.height = 0;

    decoder = await Decoder.create(stream, { exitOnError: false });

    // Send the image data
    const packet = new Packet();
    packet.alloc();
    packet.streamIndex = stream.index;
    packet.pts = 0n;
    packet.dts = 0n;
    packet.timeBase = new Rational(1, 25);
    packet.data = Buffer.from(data);
    packet.duration = 1n;

    await decoder.decode(packet);
    packet.unref();

    // Get a frame to determine dimensions
    const frame = await decoder.receive();
    if (frame) {
      const width = frame.width;
      const height = frame.height;
      frame.unref();
      return { width, height };
    }

    return { width: 0, height: 0 };
  } catch {
    return { width: 0, height: 0 };
  } finally {
    decoder?.close();
  }
}
