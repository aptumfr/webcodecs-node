/**
 * AudioEncoder type definitions
 */

import type { EncodedAudioChunk } from '../../core/EncodedAudioChunk.js';

export type CodecState = 'unconfigured' | 'configured' | 'closed';

/**
 * Opus-specific encoder configuration
 * https://www.w3.org/TR/webcodecs-opus-codec-registration/
 */
export interface OpusEncoderConfig {
  /** Output format: only 'opus' (raw Opus packets) is supported at encoder level.
   *  'ogg' encapsulation is handled by the muxer, not the encoder. */
  format?: 'opus';
  /** Frame duration in microseconds (2500, 5000, 10000, 20000, 40000, 60000, 80000, 100000, 120000) */
  frameDuration?: number;
  /** Opus application mode */
  application?: 'voip' | 'audio' | 'lowdelay';
  /** Packet loss percentage for forward error correction (0-100) - per WebCodecs spec (lowercase) */
  packetlossperc?: number;
  /** Use in-band forward error correction */
  useinbandfec?: boolean;
  /** Use discontinuous transmission mode (for silence suppression) */
  usedtx?: boolean;
  /** Signal type hint for encoder optimization */
  signal?: 'auto' | 'music' | 'voice';
  /** Complexity (0-10, higher = better quality but more CPU) */
  complexity?: number;
}

/**
 * AAC-specific encoder configuration
 * https://www.w3.org/TR/webcodecs-aac-codec-registration/
 */
export interface AacEncoderConfig {
  /** Output format: 'aac' for raw AAC, 'adts' for ADTS-framed */
  format?: 'aac' | 'adts';
}

export interface AudioEncoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
  bitrateMode?: 'constant' | 'variable';
  latencyMode?: 'quality' | 'realtime';
  /**
   * @deprecated Use codec-specific config (aac.format) instead.
   * Top-level format for backwards compatibility.
   */
  format?: 'adts' | 'aac';
  /** Opus-specific configuration */
  opus?: OpusEncoderConfig;
  /** AAC-specific configuration */
  aac?: AacEncoderConfig;
}

export interface AudioEncoderInit {
  output: (chunk: EncodedAudioChunk, metadata?: AudioEncoderOutputMetadata) => void;
  error: (error: Error) => void;
}

export interface AudioEncoderOutputMetadata {
  decoderConfig?: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    description?: Uint8Array;
  };
}

export interface AudioEncoderSupport {
  supported: boolean;
  config: AudioEncoderConfig;
}
