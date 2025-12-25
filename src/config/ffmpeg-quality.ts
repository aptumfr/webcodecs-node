/**
 * FFmpeg quality overrides
 *
 * This module provides backwards compatibility with the old ffmpeg-quality.js config.
 * New code should use webcodecs-config.js via getQualityConfig() instead.
 */

import { getQualityConfig } from './webcodecs-config.js';

export type FfmpegQualityOverrides = {
  crf?: number;
  preset?: string;
  perCodec?: Record<string, { crf?: number; preset?: string }>;
};

/**
 * Get quality overrides for a codec
 * Uses unified webcodecs-config.js
 */
export function getFfmpegQualityOverrides(codecName: string): { crf?: number; preset?: string } {
  return getQualityConfig(codecName);
}
