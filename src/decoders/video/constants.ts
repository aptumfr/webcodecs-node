/**
 * VideoDecoder constants
 */

import type { VideoPixelFormat } from '../../core/VideoFrame.js';

export const SUPPORTED_OUTPUT_FORMATS: VideoPixelFormat[] = [
  'I420', 'I420A', 'I422', 'I422A', 'I444', 'I444A', 'NV12', 'RGBA', 'RGBX', 'BGRA', 'BGRX',
  // 10-bit formats
  'I420P10', 'I420AP10', 'I422P10', 'I422AP10', 'I444P10', 'I444AP10', 'P010',
  // 12-bit formats
  'I420P12', 'I420AP12', 'I422P12', 'I422AP12', 'I444P12', 'I444AP12'
];

export const DEFAULT_FLUSH_TIMEOUT = 30000;
export const DEFAULT_MAX_QUEUE_SIZE = 100; // Fallback if resolution unknown
