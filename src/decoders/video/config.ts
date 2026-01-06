/**
 * VideoDecoder configuration validation and support checking
 */

import { toUint8Array } from '../../utils/buffer.js';
import { parseCodec } from '../../utils/codec-cache.js';
import { validateVideoDecoderConfig, validateVideoCodec } from '../../utils/codec-validation.js';
import { SUPPORTED_OUTPUT_FORMATS } from './constants.js';
import type { VideoDecoderConfig, VideoDecoderSupport } from './types.js';

/**
 * Clone a VideoDecoderConfig per WebCodecs spec
 */
export function cloneConfig(config: VideoDecoderConfig): VideoDecoderConfig {
  const clonedConfig: VideoDecoderConfig = {
    codec: config.codec,
  };

  // Copy optional properties if present
  if (config.codedWidth !== undefined) clonedConfig.codedWidth = config.codedWidth;
  if (config.codedHeight !== undefined) clonedConfig.codedHeight = config.codedHeight;
  if (config.displayAspectWidth !== undefined) clonedConfig.displayAspectWidth = config.displayAspectWidth;
  if (config.displayAspectHeight !== undefined) clonedConfig.displayAspectHeight = config.displayAspectHeight;
  if (config.colorSpace !== undefined) clonedConfig.colorSpace = { ...config.colorSpace };
  if (config.hardwareAcceleration !== undefined) clonedConfig.hardwareAcceleration = config.hardwareAcceleration;
  if (config.optimizeForLatency !== undefined) clonedConfig.optimizeForLatency = config.optimizeForLatency;
  if (config.outputFormat !== undefined) clonedConfig.outputFormat = config.outputFormat;
  if (config.maxQueueSize !== undefined) clonedConfig.maxQueueSize = config.maxQueueSize;

  return clonedConfig;
}

/**
 * Check if output format is supported for the given codec
 */
export function isOutputFormatSupported(config: VideoDecoderConfig): boolean {
  if (!config.outputFormat) {
    return true;
  }

  // Validate the requested output format is supported
  if (!SUPPORTED_OUTPUT_FORMATS.includes(config.outputFormat)) {
    return false;
  }

  // Some formats have codec-specific limitations
  const parsed = parseCodec(config.codec);

  // 10-bit output formats require codecs that support 10-bit decoding
  const is10BitFormat = config.outputFormat === 'I420P10' ||
    config.outputFormat === 'I422P10' ||
    config.outputFormat === 'I444P10' ||
    config.outputFormat === 'P010';

  if (is10BitFormat) {
    // Only HEVC, VP9, and AV1 support 10-bit content
    const supports10Bit = parsed.name === 'hevc' || parsed.name === 'vp9' || parsed.name === 'av1';
    if (!supports10Bit) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a VideoDecoderConfig is supported
 */
export async function checkConfigSupport(config: VideoDecoderConfig): Promise<VideoDecoderSupport> {
  // Validate config - throws TypeError for invalid configs per spec
  validateVideoDecoderConfig(config);

  // Clone the config per WebCodecs spec
  const clonedConfig = cloneConfig(config);

  // Parse description if provided (convert BufferSource to Uint8Array)
  if (config.description !== undefined) {
    try {
      clonedConfig.description = toUint8Array(config.description);
    } catch {
      return { supported: false, config: clonedConfig };
    }
  }

  // Validate codec string format and check if supported
  const codecValidation = validateVideoCodec(config.codec);
  if (!codecValidation.supported) {
    return { supported: false, config: clonedConfig };
  }

  // Check outputFormat compatibility
  if (!isOutputFormatSupported(config)) {
    return { supported: false, config: clonedConfig };
  }

  return { supported: true, config: clonedConfig };
}
