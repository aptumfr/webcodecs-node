/**
 * FFmpeg-backed VideoDecoder for Mediabunny
 *
 * Implements Mediabunny's CustomVideoDecoder interface using node-av native bindings.
 * Supports hardware acceleration via VAAPI, CUDA/CUVID, QSV.
 */

import {
  CustomVideoDecoder,
  VideoSample,
  EncodedPacket,
  VideoCodec,
} from 'mediabunny';
import { NodeAvVideoDecoder } from '../node-av/NodeAvVideoDecoder.js';

// Map Mediabunny codec to internal codec name
const CODEC_NAME_MAP: Record<VideoCodec, string> = {
  avc: 'h264',
  hevc: 'hevc',
  vp8: 'vp8',
  vp9: 'vp9',
  av1: 'av1',
};

export class FFmpegVideoDecoder extends CustomVideoDecoder {
  private backend: NodeAvVideoDecoder | null = null;
  private frameIndex = 0;
  private resolveFlush: (() => void) | null = null;
  // Track input packet timestamps for output frames
  private packetTimestamps: number[] = [];
  private packetDurations: number[] = [];

  static supports(codec: VideoCodec, _config: VideoDecoderConfig): boolean {
    return codec in CODEC_NAME_MAP;
  }

  async init(): Promise<void> {
    const width = this.config.codedWidth ?? 1920;
    const height = this.config.codedHeight ?? 1080;

    // Hardware acceleration preference from config
    const hwPref = (this.config as any).hardwareAcceleration as
      'prefer-hardware' | 'prefer-software' | 'no-preference' | undefined;

    // Create node-av backend
    this.backend = new NodeAvVideoDecoder();

    const codecName = CODEC_NAME_MAP[this.codec];

    // Convert description to Buffer if present
    let description: Buffer | undefined;
    if (this.config.description) {
      if (this.config.description instanceof ArrayBuffer) {
        description = Buffer.from(this.config.description);
      } else if (ArrayBuffer.isView(this.config.description)) {
        description = Buffer.from(
          this.config.description.buffer,
          this.config.description.byteOffset,
          this.config.description.byteLength
        );
      }
    }

    this.backend.startDecoder({
      codec: codecName,
      width,
      height,
      description,
      outputPixelFormat: 'rgba',
      hardwareAcceleration: hwPref,
    });

    // Listen for decoded frames
    this.backend.on('frame', (frameData: Buffer) => {
      this.emitSample(frameData);
    });

    this.backend.on('error', (err: Error) => {
      console.error('[FFmpegVideoDecoder] Backend error:', err.message);
    });

    this.backend.on('close', () => {
      if (this.resolveFlush) {
        this.resolveFlush();
        this.resolveFlush = null;
      }
    });
  }

  async decode(packet: EncodedPacket): Promise<void> {
    if (!this.backend?.isHealthy) {
      throw new Error('Decoder not initialized');
    }

    // Store packet timing info for output frames
    this.packetTimestamps.push(packet.timestamp);
    this.packetDurations.push(packet.duration);

    // Write encoded data to backend
    this.backend.write(Buffer.from(packet.data));
  }

  async flush(): Promise<void> {
    return new Promise((resolve) => {
      this.resolveFlush = resolve;

      if (this.backend) {
        this.backend.end();
      } else {
        resolve();
      }
    });
  }

  async close(): Promise<void> {
    if (this.backend) {
      this.backend.kill();
      this.backend = null;
    }
  }

  /**
   * Emit a decoded VideoSample via Mediabunny callback
   */
  private emitSample(data: Buffer): void {
    const width = this.config.codedWidth ?? 1920;
    const height = this.config.codedHeight ?? 1080;

    // Use stored timestamp from input packet, or calculate from frame index
    let timestampSeconds: number;
    let durationSeconds: number;

    if (this.packetTimestamps.length > 0) {
      timestampSeconds = this.packetTimestamps.shift()!;
      durationSeconds = this.packetDurations.shift() ?? (1 / 30);
    } else {
      // Fallback to calculated timestamp
      const framerate = 30;
      timestampSeconds = this.frameIndex / framerate;
      durationSeconds = 1 / framerate;
    }

    // Create VideoSample from raw pixel data
    const sample = new VideoSample(new Uint8Array(data), {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: timestampSeconds,
      duration: durationSeconds,
    });

    this.frameIndex++;
    this.onSample(sample);
  }
}
