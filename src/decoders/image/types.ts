/**
 * ImageDecoder type definitions
 */

import type { VideoPixelFormat } from '../../types/video.js';

export type ColorSpaceConversion = 'none' | 'default';
export type PremultiplyAlpha = 'none' | 'premultiply' | 'default';

export interface ImageDecoderInit {
  type: string;
  data: ArrayBuffer | ArrayBufferView | ReadableStream<ArrayBufferView>;
  colorSpaceConversion?: ColorSpaceConversion;
  desiredWidth?: number;
  desiredHeight?: number;
  preferAnimation?: boolean;
  premultiplyAlpha?: PremultiplyAlpha;
  transfer?: ArrayBuffer[];
  /**
   * Preferred output pixel format.
   * - 'RGBA' (default): RGB with alpha channel, suitable for display
   * - 'I420': YUV 4:2:0 planar, efficient for video processing
   * - 'I420P10': 10-bit YUV 4:2:0, for HDR content (AVIF, etc.)
   * - Other formats as supported by the decoder
   *
   * Note: WebP images always output RGBA due to node-webpmux limitations.
   * JPEG/AVIF can output I420 directly for better performance.
   */
  preferredPixelFormat?: VideoPixelFormat;
}

export interface ImageDecodeOptions {
  frameIndex?: number;
  completeFramesOnly?: boolean;
}

export interface ImageDecodeResult {
  image: import('../../core/VideoFrame.js').VideoFrame;
  complete: boolean;
}
