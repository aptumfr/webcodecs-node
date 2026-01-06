/**
 * Image decoder type definitions
 */

import type { VideoColorSpaceInit } from '../../formats/index.js';
import type { VideoPixelFormat } from '../../core/VideoFrame.js';

export interface DecodedImageFrame {
  data: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
  duration: number;
  complete: boolean;
  colorSpace?: VideoColorSpaceInit;
  format: VideoPixelFormat;
}

export interface ImageDecoderConfig {
  mimeType: string;
  data: Uint8Array;
  desiredWidth?: number;
  desiredHeight?: number;
  colorSpace?: VideoColorSpaceInit;
  /** Preferred output pixel format. If not specified, defaults to RGBA. */
  preferredFormat?: VideoPixelFormat;
}
