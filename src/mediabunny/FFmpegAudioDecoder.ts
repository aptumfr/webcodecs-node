/**
 * FFmpeg-backed AudioDecoder for Mediabunny
 *
 * Implements Mediabunny's CustomAudioDecoder interface using node-av native bindings.
 */

import {
  CustomAudioDecoder,
  AudioSample,
  EncodedPacket,
  AudioCodec,
} from 'mediabunny';
import { NodeAvAudioDecoder } from '../node-av/NodeAvAudioDecoder.js';

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

export class FFmpegAudioDecoder extends CustomAudioDecoder {
  private backend: NodeAvAudioDecoder | null = null;
  private frameIndex = 0;
  private resolveFlush: (() => void) | null = null;
  // Track base timestamp from first input packet
  private baseTimestamp: number = 0;
  private hasBaseTimestamp: boolean = false;

  static supports(codec: AudioCodec, _config: AudioDecoderConfig): boolean {
    return codec in CODEC_NAME_MAP;
  }

  async init(): Promise<void> {
    const sampleRate = this.config.sampleRate ?? 44100;
    const numberOfChannels = this.config.numberOfChannels ?? 2;

    // Create node-av backend
    this.backend = new NodeAvAudioDecoder();

    const codecName = CODEC_NAME_MAP[this.codec] || 'aac';

    // Convert description to ArrayBufferView if present
    let description: ArrayBufferView | undefined;
    if (this.config.description) {
      if (this.config.description instanceof ArrayBuffer) {
        description = new Uint8Array(this.config.description);
      } else if (ArrayBuffer.isView(this.config.description)) {
        description = this.config.description;
      }
    }

    this.backend.startDecoder({
      codec: codecName,
      sampleRate,
      numberOfChannels,
      description,
      outputFormat: 'f32',
    });

    // Listen for decoded frames
    this.backend.on('frame', (frame: { data: Buffer; numberOfFrames: number; timestamp: number }) => {
      this.emitAudioSample(frame.data, frame.numberOfFrames);
    });

    this.backend.on('error', (err: Error) => {
      console.error('[FFmpegAudioDecoder] Backend error:', err.message);
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

    // Capture the base timestamp from the first packet
    if (!this.hasBaseTimestamp) {
      this.baseTimestamp = packet.timestamp;
      this.hasBaseTimestamp = true;
    }

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
   * Emit an AudioSample via Mediabunny callback
   */
  private emitAudioSample(data: Buffer, numberOfFrames: number): void {
    if (data.length === 0 || numberOfFrames === 0) return;

    const sampleRate = this.config.sampleRate ?? 44100;
    const numberOfChannels = this.config.numberOfChannels ?? 2;

    // Calculate timestamp in seconds, preserving base timestamp from input
    const offsetSeconds = this.frameIndex / sampleRate;
    const timestampSeconds = this.baseTimestamp + offsetSeconds;

    // Create AudioSample from raw f32 interleaved data
    const sample = new AudioSample({
      format: 'f32',
      sampleRate,
      numberOfChannels,
      timestamp: timestampSeconds,
      data: new Uint8Array(data),
    });

    this.frameIndex += numberOfFrames;
    this.onSample(sample);
  }
}
