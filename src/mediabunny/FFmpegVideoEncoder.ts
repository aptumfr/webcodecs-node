/**
 * FFmpeg-backed VideoEncoder for Mediabunny
 *
 * Implements Mediabunny's CustomVideoEncoder interface using node-av native bindings.
 * Supports hardware acceleration via VAAPI, NVENC, QSV, VideoToolbox.
 */

import {
  CustomVideoEncoder,
  VideoSample,
  EncodedPacket,
  VideoCodec,
} from 'mediabunny';
import { NodeAvVideoEncoder } from '../node-av/NodeAvVideoEncoder.js';
import {
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
  convertAnnexBToAvcc,
} from '../utils/avc.js';
import {
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
} from '../utils/hevc.js';

// Map Mediabunny codec to internal codec name
const CODEC_NAME_MAP: Record<VideoCodec, string> = {
  avc: 'h264',
  hevc: 'hevc',
  vp8: 'vp8',
  vp9: 'vp9',
  av1: 'av1',
};

export class FFmpegVideoEncoder extends CustomVideoEncoder {
  private backend: NodeAvVideoEncoder | null = null;
  private frameIndex = 0;
  private codecDescription: Uint8Array | null = null;
  private metadataEmitted = false;
  private bitstreamFormat: 'annexb' | 'mp4' = 'annexb';
  private useAnnexB = false;
  private resolveFlush: (() => void) | null = null;
  private pendingPackets: Array<{ data: Buffer; timestamp: number; keyFrame: boolean }> = [];

  static supports(codec: VideoCodec, _config: VideoEncoderConfig): boolean {
    return codec in CODEC_NAME_MAP;
  }

  async init(): Promise<void> {
    // Determine bitstream format from config
    const configExt = this.config as Record<string, any>;
    this.useAnnexB = this.codec === 'avc' || this.codec === 'hevc';
    if (this.codec === 'avc' && configExt.avc?.format === 'avc') {
      this.bitstreamFormat = 'mp4';
    } else if (this.codec === 'hevc' && configExt.hevc?.format === 'hevc') {
      this.bitstreamFormat = 'mp4';
    } else {
      this.bitstreamFormat = 'annexb';
    }

    // Hardware acceleration preference from config
    const hwPref = (this.config as any).hardwareAcceleration as
      'prefer-hardware' | 'prefer-software' | 'no-preference' | undefined;

    // Create node-av backend
    this.backend = new NodeAvVideoEncoder();

    const codecName = CODEC_NAME_MAP[this.codec];
    this.backend.startEncoder({
      codec: codecName,
      width: this.config.width,
      height: this.config.height,
      framerate: this.config.framerate ?? 30,
      bitrate: this.config.bitrate,
      inputPixelFormat: 'rgba',
    } as any);

    // Set hardware acceleration preference on backend config
    if (hwPref) {
      (this.backend as any).config.hardwareAcceleration = hwPref;
    }

    // Listen for encoded frames
    this.backend.on('encodedFrame', (frame: { data: Buffer; timestamp: number; keyFrame: boolean }) => {
      this.pendingPackets.push(frame);
      this.processPackets();
    });

    this.backend.on('error', (err: Error) => {
      console.error('[FFmpegVideoEncoder] Backend error:', err.message);
    });

    this.backend.on('close', () => {
      // Process any remaining packets
      this.processPackets();
      if (this.resolveFlush) {
        this.resolveFlush();
        this.resolveFlush = null;
      }
    });
  }

  async encode(videoSample: VideoSample, _options: { keyFrame?: boolean }): Promise<void> {
    if (!this.backend?.isHealthy) {
      throw new Error('Encoder not initialized');
    }

    // Get raw RGBA data from VideoSample
    const frameData = await this.getFrameData(videoSample);
    this.backend.write(frameData);
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

  private processPackets(): void {
    while (this.pendingPackets.length > 0) {
      const packet = this.pendingPackets.shift()!;
      this.emitPacket(packet.data, packet.timestamp, packet.keyFrame);
    }
  }

  /**
   * Extract raw RGBA pixel data from VideoSample
   */
  private async getFrameData(sample: VideoSample): Promise<Buffer> {
    const width = sample.codedWidth;
    const height = sample.codedHeight;
    const size = width * height * 4; // RGBA

    // VideoSample stores data in _data which can be:
    // - VideoFrame (browser)
    // - Uint8Array (raw data)
    // - OffscreenCanvas (canvas fallback)

    const sampleData = (sample as any)._data;

    // If _data is already a Uint8Array, use it directly
    if (sampleData instanceof Uint8Array) {
      return Buffer.from(sampleData);
    }

    // Try to use copyTo if available (works for VideoFrame and VideoSample)
    if (typeof sample.copyTo === 'function') {
      const buffer = new Uint8Array(size);
      await sample.copyTo(buffer);
      return Buffer.from(buffer);
    }

    // If it's a VideoFrame, use its copyTo method
    if (sampleData && typeof sampleData.copyTo === 'function') {
      const buffer = new Uint8Array(size);
      await sampleData.copyTo(buffer);
      return Buffer.from(buffer);
    }

    throw new Error('Cannot extract frame data from VideoSample');
  }

  /**
   * Find all Annex B start codes in buffer
   */
  private findStartCodes(buf: Buffer): Array<{ pos: number; len: number }> {
    const codes: Array<{ pos: number; len: number }> = [];
    let i = 0;

    while (i < buf.length - 2) {
      if (buf[i] === 0 && buf[i + 1] === 0) {
        if (buf[i + 2] === 1) {
          codes.push({ pos: i, len: 3 });
          i += 3;
        } else if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) {
          codes.push({ pos: i, len: 4 });
          i += 4;
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    return codes;
  }

  /**
   * Get NAL unit type from first byte after start code
   */
  private getNalType(firstByte: number): number {
    if (this.codec === 'avc') {
      return firstByte & 0x1f;
    } else {
      return (firstByte >> 1) & 0x3f;
    }
  }

  /**
   * Emit an encoded packet via Mediabunny callback
   */
  private emitPacket(data: Buffer, timestamp: number, isKey: boolean): void {
    const framerate = this.config.framerate ?? 30;
    const timestampSeconds = timestamp / framerate;
    const durationSeconds = 1 / framerate;

    let payload = data;
    if (this.useAnnexB && this.bitstreamFormat === 'mp4') {
      payload = this.convertAnnexBFrame(data);
    }

    const packet = new EncodedPacket(
      new Uint8Array(payload),
      isKey ? 'key' : 'delta',
      timestampSeconds,
      durationSeconds
    );

    // Build metadata with decoder config (required by Mediabunny)
    // Only emit full metadata on first packet or keyframes
    let meta: EncodedVideoChunkMetadata | undefined;

    if (!this.metadataEmitted || isKey) {
      // Extract codec description from first keyframe for AVC/HEVC
      if (isKey && this.useAnnexB && !this.codecDescription) {
        this.codecDescription = this.buildCodecDescription(data);
      }

      meta = {
        decoderConfig: {
          codec: this.getCodecString(),
          codedWidth: this.config.width,
          codedHeight: this.config.height,
          description: this.codecDescription ?? undefined,
        },
      };
      this.metadataEmitted = true;
    }

    this.frameIndex++;
    this.onPacket(packet, meta);
  }

  /**
   * Get codec string for the output format
   */
  private getCodecString(): string {
    switch (this.codec) {
      case 'avc':
        // AVC codec string: avc1.PPCCLL (profile, constraints, level)
        // Default to High profile, level 4.0
        return 'avc1.640028';
      case 'hevc':
        // HEVC codec string
        return 'hev1.1.6.L93.B0';
      case 'vp8':
        return 'vp8';
      case 'vp9':
        // VP9 codec string: vp09.PP.LL.DD (profile, level, bit depth)
        return 'vp09.00.10.08';
      case 'av1':
        // AV1 codec string
        return 'av01.0.01M.08';
      default:
        return this.codec;
    }
  }

  private buildCodecDescription(data: Buffer): Uint8Array | null {
    if (!this.useAnnexB) {
      return null;
    }

    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    if (this.codec === 'avc') {
      const { sps, pps } = extractAvcParameterSetsFromAnnexB(view);
      if (sps.length && pps.length) {
        return buildAvcDecoderConfig(sps, pps);
      }
    } else if (this.codec === 'hevc') {
      const { vps, sps, pps } = extractHevcParameterSetsFromAnnexB(view);
      if (sps.length && pps.length) {
        return buildHvccDecoderConfig(vps, sps, pps);
      }
    }

    return null;
  }

  private convertAnnexBFrame(data: Buffer): Buffer {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (this.codec === 'avc') {
      return convertAnnexBToAvcc(view);
    }
    if (this.codec === 'hevc') {
      return convertAnnexBToHvcc(view);
    }
    return data;
  }
}
