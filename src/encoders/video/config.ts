/**
 * VideoEncoder configuration validation and support checking
 */

import { parseCodec, getCodecBase } from '../../utils/codec-cache.js';
import { validateVideoEncoderConfig, validateVideoCodec } from '../../utils/codec-validation.js';
import type { VideoEncoderConfig, VideoEncoderSupport } from './types.js';

/**
 * Clone a VideoEncoderConfig per WebCodecs spec
 */
export function cloneConfig(config: VideoEncoderConfig): VideoEncoderConfig {
  const clonedConfig: VideoEncoderConfig = {
    codec: config.codec,
    width: config.width,
    height: config.height,
  };

  // Copy optional properties if present
  if (config.displayWidth !== undefined) clonedConfig.displayWidth = config.displayWidth;
  if (config.displayHeight !== undefined) clonedConfig.displayHeight = config.displayHeight;
  if (config.bitrate !== undefined) clonedConfig.bitrate = config.bitrate;
  if (config.framerate !== undefined) clonedConfig.framerate = config.framerate;
  if (config.hardwareAcceleration !== undefined) clonedConfig.hardwareAcceleration = config.hardwareAcceleration;
  if (config.alpha !== undefined) clonedConfig.alpha = config.alpha;
  if (config.scalabilityMode !== undefined) clonedConfig.scalabilityMode = config.scalabilityMode;
  if (config.bitrateMode !== undefined) clonedConfig.bitrateMode = config.bitrateMode;
  if (config.latencyMode !== undefined) clonedConfig.latencyMode = config.latencyMode;
  if (config.format !== undefined) clonedConfig.format = config.format;
  if (config.avc !== undefined) clonedConfig.avc = { ...config.avc };
  if (config.hevc !== undefined) clonedConfig.hevc = { ...config.hevc };
  if (config.av1 !== undefined) clonedConfig.av1 = { ...config.av1 };
  if (config.colorSpace !== undefined) clonedConfig.colorSpace = { ...config.colorSpace };
  if (config.maxQueueSize !== undefined) clonedConfig.maxQueueSize = config.maxQueueSize;
  if (config.contentHint !== undefined) clonedConfig.contentHint = config.contentHint;

  return clonedConfig;
}

/**
 * Check dimension constraints for encoder config
 */
export function areDimensionsSupported(config: VideoEncoderConfig): boolean {
  // Check for odd dimensions
  // VP9 and AV1 (software) support odd dimensions, others require even for YUV420 subsampling
  const hasOddDimension = config.width % 2 !== 0 || config.height % 2 !== 0;
  if (hasOddDimension) {
    const codecBase = getCodecBase(config.codec);
    const isVp9 = codecBase === 'vp09';
    const isAv1 = codecBase === 'av01';
    const prefersHardware = config.hardwareAcceleration === 'prefer-hardware';

    // VP9 and AV1 (software) can handle odd dimensions
    // Hardware encoders generally cannot
    const codecSupportsOddDimensions = (isVp9 || isAv1) && !prefersHardware;
    if (!codecSupportsOddDimensions) {
      return false;
    }
  }

  // Check for unreasonably large dimensions
  if (config.width > 16384 || config.height > 16384) {
    return false;
  }

  return true;
}

/**
 * Check if alpha channel is supported for the codec
 */
export function isAlphaSupported(config: VideoEncoderConfig): boolean {
  if (config.alpha !== 'keep') {
    return true;
  }

  // Alpha channel support: only VP9 software encoding supports alpha
  // H.264, HEVC, AV1 do not support alpha encoding
  const parsed = parseCodec(config.codec);
  return parsed.name === 'vp9' && config.hardwareAcceleration !== 'prefer-hardware';
}

/**
 * Check if quantizer bitrate mode is supported for the codec
 */
export function isQuantizerModeSupported(config: VideoEncoderConfig): boolean {
  if (config.bitrateMode !== 'quantizer') {
    return true;
  }

  // Quantizer bitrate mode: only some codecs support CRF/CQ mode
  // H.264, HEVC, VP9, AV1 support quantizer mode
  // VP8 does not support quantizer mode (uses bitrate-based VBR only)
  const parsed = parseCodec(config.codec);
  return parsed.name === 'h264' || parsed.name === 'hevc' ||
    parsed.name === 'vp9' || parsed.name === 'av1';
}

/**
 * Check if a VideoEncoderConfig is supported
 */
export async function checkConfigSupport(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
  // Validate config - throws TypeError for invalid configs per spec
  validateVideoEncoderConfig(config);

  // Clone the config per WebCodecs spec
  const clonedConfig = cloneConfig(config);

  // Check dimension constraints
  if (!areDimensionsSupported(config)) {
    return { supported: false, config: clonedConfig };
  }

  // Validate codec string format and check if supported
  const codecValidation = validateVideoCodec(config.codec);
  if (!codecValidation.supported) {
    return { supported: false, config: clonedConfig };
  }

  // Check alpha support
  if (!isAlphaSupported(config)) {
    return { supported: false, config: clonedConfig };
  }

  // Check quantizer mode support
  if (!isQuantizerModeSupported(config)) {
    return { supported: false, config: clonedConfig };
  }

  // scalabilityMode (SVC) is not supported
  if (config.scalabilityMode !== undefined && config.scalabilityMode !== '') {
    return { supported: false, config: clonedConfig };
  }

  return { supported: true, config: clonedConfig };
}
