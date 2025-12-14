/**
 * FFmpeg-backed AudioEncoder for Mediabunny
 *
 * Implements Mediabunny's CustomAudioEncoder interface using node-av native bindings.
 */

import {
  CustomAudioEncoder,
  AudioSample,
  EncodedPacket,
  AudioCodec,
} from 'mediabunny';
import { NodeAvAudioEncoder } from '../node-av/NodeAvAudioEncoder.js';
import { buildAudioSpecificConfig } from '../utils/aac.js';

// Map Mediabunny codec to internal codec name
const CODEC_NAME_MAP: Record<AudioCodec, string> = {
  'aac': 'aac',
  'opus': 'opus',
  'mp3': 'mp3',
  'flac': 'flac',
  'vorbis': 'vorbis',
  'pcm-s16': 'pcm-s16',
  'pcm-s16be': 'pcm-s16',
  'pcm-s24': 'pcm-s16',
  'pcm-s24be': 'pcm-s16',
  'pcm-s32': 'pcm-s16',
  'pcm-s32be': 'pcm-s16',
  'pcm-f32': 'pcm-f32',
  'pcm-f32be': 'pcm-f32',
  'pcm-f64': 'pcm-f32',
  'pcm-f64be': 'pcm-f32',
  'pcm-u8': 'pcm-s16',
  'pcm-s8': 'pcm-s16',
  'ulaw': 'pcm-s16',
  'alaw': 'pcm-s16',
};

export class FFmpegAudioEncoder extends CustomAudioEncoder {
  private backend: NodeAvAudioEncoder | null = null;
  private frameIndex = 0;
  private resolveFlush: (() => void) | null = null;
  private metadataEmitted = false;
  private codecDescription: Uint8Array | null = null;

  static supports(codec: AudioCodec, _config: AudioEncoderConfig): boolean {
    return codec in CODEC_NAME_MAP;
  }

  async init(): Promise<void> {
    // Create node-av backend
    this.backend = new NodeAvAudioEncoder();

    const codecName = CODEC_NAME_MAP[this.codec] || 'aac';
    this.backend.startEncoder({
      codec: codecName,
      sampleRate: this.config.sampleRate,
      numberOfChannels: this.config.numberOfChannels,
      bitrate: this.config.bitrate,
    });

    // Listen for encoded frames
    this.backend.on('encodedFrame', (frame: { data: Buffer; timestamp: number; keyFrame: boolean }) => {
      this.emitPacket(frame.data);
    });

    this.backend.on('error', (err: Error) => {
      console.error('[FFmpegAudioEncoder] Backend error:', err.message);
    });

    this.backend.on('close', () => {
      if (this.resolveFlush) {
        this.resolveFlush();
        this.resolveFlush = null;
      }
    });
  }

  async encode(audioSample: AudioSample): Promise<void> {
    if (!this.backend?.isHealthy) {
      throw new Error('Encoder not initialized');
    }

    // Get raw PCM data from AudioSample (f32 interleaved)
    const pcmData = await this.getSampleData(audioSample);
    this.backend.write(pcmData);
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
   * Extract raw PCM data from AudioSample
   */
  private async getSampleData(sample: AudioSample): Promise<Buffer> {
    const numFrames = sample.numberOfFrames;
    const numChannels = sample.numberOfChannels;
    const bufferSize = numFrames * numChannels * 4; // f32 = 4 bytes
    const buffer = Buffer.alloc(bufferSize);

    // Copy data from sample (convert to f32 interleaved if needed)
    const isPlanar = sample.format.endsWith('-planar');

    if (isPlanar) {
      // Planar: interleave channels
      const tempBuffer = new Float32Array(numFrames);
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

      for (let ch = 0; ch < numChannels; ch++) {
        sample.copyTo(new Uint8Array(tempBuffer.buffer), {
          planeIndex: ch,
          format: 'f32',
        });

        for (let frame = 0; frame < numFrames; frame++) {
          const offset = (frame * numChannels + ch) * 4;
          view.setFloat32(offset, tempBuffer[frame], true);
        }
      }
    } else {
      // Already interleaved
      sample.copyTo(buffer, { planeIndex: 0, format: 'f32' });
    }

    return buffer;
  }

  /**
   * Get the number of samples per frame based on codec
   */
  private getFrameSamples(): number {
    switch (this.codec) {
      case 'opus':
        return 960;
      case 'aac':
        return 1024;
      case 'mp3':
        return 1152;
      case 'vorbis':
        return 1024;
      case 'flac':
        return 4096;
      default:
        return 1024;
    }
  }

  /**
   * Emit an encoded packet via Mediabunny callback
   */
  private emitPacket(data: Buffer): void {
    const sampleRate = this.config.sampleRate;
    const frameSamples = this.getFrameSamples();

    const timestampSeconds = this.frameIndex / sampleRate;
    const durationSeconds = frameSamples / sampleRate;

    const packet = new EncodedPacket(
      new Uint8Array(data),
      'key',
      timestampSeconds,
      durationSeconds
    );

    // Build metadata with decoder config
    let meta: EncodedAudioChunkMetadata | undefined;

    if (!this.metadataEmitted) {
      if (!this.codecDescription) {
        if (this.codec === 'opus') {
          this.codecDescription = this.buildOpusDescription();
        } else if (this.codec === 'aac') {
          this.codecDescription = this.buildAacDescription();
        }
      }

      meta = {
        decoderConfig: {
          codec: this.getCodecString(),
          sampleRate: this.config.sampleRate,
          numberOfChannels: this.config.numberOfChannels,
          description: this.codecDescription ?? undefined,
        },
      };
      this.metadataEmitted = true;
    }

    this.frameIndex += frameSamples;
    this.onPacket(packet, meta);
  }

  /**
   * Get codec string for the output format
   */
  private getCodecString(): string {
    switch (this.codec) {
      case 'aac':
        return 'mp4a.40.2';
      case 'opus':
        return 'opus';
      case 'mp3':
        return 'mp3';
      case 'flac':
        return 'flac';
      case 'vorbis':
        return 'vorbis';
      default:
        return this.codec;
    }
  }

  /**
   * Build Opus identification header for decoder config description
   */
  private buildOpusDescription(): Uint8Array {
    const header = Buffer.alloc(19);
    let offset = 0;

    header.write('OpusHead', offset);
    offset += 8;
    header[offset++] = 1;
    header[offset++] = this.config.numberOfChannels;
    header.writeUInt16LE(312, offset);
    offset += 2;
    header.writeUInt32LE(this.config.sampleRate, offset);
    offset += 4;
    header.writeInt16LE(0, offset);
    offset += 2;
    header[offset++] = 0;

    return new Uint8Array(header);
  }

  /**
   * Build AAC AudioSpecificConfig for decoder config description
   */
  private buildAacDescription(): Uint8Array {
    return buildAudioSpecificConfig({
      samplingRate: this.config.sampleRate,
      channelConfiguration: this.config.numberOfChannels,
    });
  }
}
