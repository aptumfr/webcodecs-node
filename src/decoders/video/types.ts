/**
 * VideoDecoder type definitions
 */

import type { VideoPixelFormat } from '../../core/VideoFrame.js';
import type { VideoColorSpaceInit } from '../../formats/index.js';

export type CodecState = 'unconfigured' | 'configured' | 'closed';

export interface VideoDecoderConfig {
  codec: string;
  description?: ArrayBuffer | ArrayBufferView;
  codedWidth?: number;
  codedHeight?: number;
  displayAspectWidth?: number;
  displayAspectHeight?: number;
  colorSpace?: VideoColorSpaceInit;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  optimizeForLatency?: boolean;
  outputFormat?: VideoPixelFormat;
  /** Frame rotation in degrees (0, 90, 180, 270) - applied to decoded frames */
  rotation?: 0 | 90 | 180 | 270;
  /** Whether to flip the frame horizontally - applied to decoded frames */
  flip?: boolean;
  /**
   * Maximum number of chunks that can be queued before decode() throws.
   * If not specified and dimensions are provided, automatically calculated based on resolution:
   * - 720p and below: 50 frames (~185MB for RGBA)
   * - 1080p: 30 frames (~250MB for RGBA)
   * - 4K: 10 frames (~330MB for RGBA)
   * - 8K: 4 frames (~530MB for RGBA)
   * If dimensions are not provided, defaults to 100.
   */
  maxQueueSize?: number;
}

export interface VideoDecoderInit {
  output: (frame: import('../../core/VideoFrame.js').VideoFrame) => void;
  error: (error: Error) => void;
}

export interface VideoDecoderSupport {
  supported: boolean;
  config: VideoDecoderConfig;
}
