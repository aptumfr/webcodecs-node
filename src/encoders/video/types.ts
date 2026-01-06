/**
 * VideoEncoder type definitions
 */

import type { EncodedVideoChunk } from '../../core/EncodedVideoChunk.js';
import type { VideoColorSpaceInit } from '../../formats/color-space.js';

export type CodecState = 'unconfigured' | 'configured' | 'closed';

/**
 * AVC/H.264-specific encoder configuration
 * https://www.w3.org/TR/webcodecs-avc-codec-registration/
 */
export interface AvcEncoderConfig {
  /** Output format: 'avc' for AVCC (length-prefixed), 'annexb' for Annex B (start codes) */
  format?: 'avc' | 'annexb';
}

/**
 * HEVC/H.265-specific encoder configuration
 * https://www.w3.org/TR/webcodecs-hevc-codec-registration/
 */
export interface HevcEncoderConfig {
  /** Output format: 'hevc' for HVCC (length-prefixed), 'annexb' for Annex B (start codes) */
  format?: 'hevc' | 'annexb';
}

/**
 * AV1-specific encoder configuration
 * https://www.w3.org/TR/webcodecs-av1-codec-registration/
 */
export interface Av1EncoderConfig {
  /** Whether to force all frames to be keyframes (for screen sharing use cases) */
  forceScreenContentTools?: boolean;
}

export interface VideoEncoderConfig {
  codec: string;
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
  bitrate?: number;
  framerate?: number;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  alpha?: 'discard' | 'keep';
  scalabilityMode?: string;
  bitrateMode?: 'constant' | 'variable' | 'quantizer';
  latencyMode?: 'quality' | 'realtime';
  /**
   * Hint about the type of content being encoded.
   * - 'text': Optimizes for text legibility (screen sharing with text)
   * - 'detail': Optimizes for fine details (screen sharing with complex graphics)
   * - 'motion': Optimizes for motion (camera video, animations)
   */
  contentHint?: 'text' | 'detail' | 'motion';
  /**
   * @deprecated Use codec-specific config (avc.format, hevc.format) instead.
   * Top-level format for backwards compatibility.
   */
  format?: 'annexb' | 'mp4';
  /** AVC/H.264-specific configuration */
  avc?: AvcEncoderConfig;
  /** HEVC/H.265-specific configuration */
  hevc?: HevcEncoderConfig;
  /** AV1-specific configuration */
  av1?: Av1EncoderConfig;
  /**
   * Color space for HDR encoding. When provided with primaries, transfer, matrix,
   * and HDR metadata (SMPTE ST 2086 / Content Light Level), the encoder will
   * set appropriate color properties in the output stream.
   */
  colorSpace?: VideoColorSpaceInit;
  /**
   * Maximum number of frames that can be queued before encode() throws.
   * If not specified, automatically calculated based on resolution:
   * - 720p and below: 50 frames (~185MB for RGBA)
   * - 1080p: 30 frames (~250MB for RGBA)
   * - 4K: 10 frames (~330MB for RGBA)
   * - 8K: 4 frames (~530MB for RGBA)
   */
  maxQueueSize?: number;
}

export interface VideoEncoderInit {
  output: (chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata) => void;
  error: (error: Error) => void;
}

export interface VideoEncoderOutputMetadata {
  decoderConfig?: {
    codec: string;
    description?: Uint8Array;
    codedWidth?: number;
    codedHeight?: number;
    displayAspectWidth?: number;
    displayAspectHeight?: number;
    colorSpace?: VideoColorSpaceInit;
    /** Frame rotation from first encoded frame */
    rotation?: 0 | 90 | 180 | 270;
    /** Frame flip from first encoded frame */
    flip?: boolean;
  };
}

export interface VideoEncoderSupport {
  supported: boolean;
  config: VideoEncoderConfig;
}

export interface VideoEncoderEncodeOptions {
  keyFrame?: boolean;
}
