/**
 * Encoder options building utilities
 *
 * Builds codec-specific encoder options for x264/x265, VP8/VP9, and SVT-AV1
 */

import { Rational } from 'node-av/lib';
import type { HardwareContext } from 'node-av/api';
import type { AVPixelFormat } from 'node-av/constants';

import type { VideoEncoderBackendConfig } from '../../../types.js';
import {
  DEFAULT_FRAMERATE,
  DEFAULT_VP_BITRATE,
  CRF_DEFAULTS,
} from '../../../types.js';
import { getQualityConfig } from '../../../../config/webcodecs-config.js';

export interface EncoderOptions {
  type: 'video';
  width: number;
  height: number;
  pixelFormat: AVPixelFormat;
  timeBase: Rational;
  frameRate: Rational;
  bitrate?: number;
  gopSize: number;
  maxBFrames?: number;
  hardware?: HardwareContext;
  options: Record<string, string | number>;
}

/**
 * Configure VP8/VP9 encoder options
 */
export function configureVpxOptions(
  options: Record<string, string | number>,
  config: VideoEncoderBackendConfig
): void {
  if (config.latencyMode === 'realtime') {
    options.deadline = 'realtime';
    options['cpu-used'] = '8';
    options['lag-in-frames'] = '0';
  } else {
    options.deadline = 'good';
    options['cpu-used'] = '4';
  }

  // Apply contentHint to optimize for content type
  if (config.contentHint === 'text' || config.contentHint === 'detail') {
    // Text/detail: lower cpu-used for higher quality (slower encoding)
    const currentCpuUsed = Number(options['cpu-used'] ?? '4');
    options['cpu-used'] = String(Math.max(0, currentCpuUsed - 2));
  }
  // 'motion' uses default settings optimized for video content
}

/**
 * Configure SVT-AV1 encoder options
 */
export function configureSvtAv1Options(
  options: Record<string, string | number>,
  config: VideoEncoderBackendConfig
): void {
  if (config.latencyMode === 'realtime') {
    options.preset = '10';
  } else {
    options.preset = '6';
  }

  // Apply AV1-specific options from config
  if (config.av1?.forceScreenContentTools) {
    // Enable screen content tools for better compression of screen content
    // This enables palette mode and intra block copy which are useful for screen sharing
    options['enable-screen-content-mode'] = '1';
  }

  // Apply contentHint to optimize encoder for content type
  if (config.contentHint === 'text') {
    // Text/graphics content: enable screen content tools for better compression
    options['enable-screen-content-mode'] = '1';
  } else if (config.contentHint === 'detail') {
    // Detail mode: prioritize quality over speed
    const currentPreset = Number(options.preset ?? '6');
    options.preset = String(Math.max(0, currentPreset - 2)); // Lower preset = higher quality
  }
  // 'motion' uses default settings optimized for video content
}

/**
 * Configure x264/x265 encoder options (software and hardware variants)
 */
export function configureX26xOptions(
  options: Record<string, string | number>,
  config: VideoEncoderBackendConfig,
  hwType?: string
): void {
  if (config.latencyMode === 'realtime') {
    if (hwType === 'cuda') {
      // NVENC presets: p1 (fastest) to p7 (slowest), or 'fast'/'medium'/'slow'
      options.preset = 'p1';
    } else if (hwType === 'qsv') {
      options.preset = 'veryfast';
    } else if (hwType === 'vaapi') {
      // VAAPI: lower quality = faster encoding, low QP for better quality
      options.quality = '0';
    } else if (!hwType) {
      // Software x264/x265
      options.preset = 'ultrafast';
    }
  } else {
    if (hwType === 'cuda') {
      // NVENC: p4 is a good balance
      options.preset = 'p4';
    } else if (hwType === 'qsv') {
      options.preset = 'medium';
    } else if (hwType === 'vaapi') {
      // VAAPI: higher quality setting
      options.quality = '4';
    } else if (!hwType) {
      // Software x264/x265
      options.preset = 'medium';
    }
  }

  // Configure rate control based on hardware type and bitrate mode
  const bitrate = config.bitrate;
  if (bitrate && config.bitrateMode !== 'quantizer') {
    if (hwType === 'vaapi') {
      // VAAPI: Use CQP mode with low QP for high quality
      // Note: node-av doesn't properly pass bitrate to VAAPI, so we use quality-based encoding
      // QP 20 gives good quality (lower = higher quality, range 0-51)
      options.qp = 20;
    } else if (hwType === 'cuda') {
      // NVENC: Use VBR mode
      options.rc = 'vbr';
    } else if (hwType === 'qsv') {
      // QSV: Use VBR mode
      options.preset = options.preset ?? 'medium';
    } else {
      // Software x264/x265: Set VBV maxrate and bufsize for proper bitrate control
      // bufsize = 2x bitrate gives ~2 second buffer, good for streaming
      options.maxrate = String(bitrate);
      options.bufsize = String(bitrate * 2);
    }
  }

  // Apply contentHint for software x264/x265 (tune parameter)
  if (!hwType && config.contentHint) {
    if (config.contentHint === 'text') {
      // Text/graphics: use stillimage tune for sharp edges
      options.tune = 'stillimage';
    } else if (config.contentHint === 'detail') {
      // Detail mode: use ssim tune for quality preservation
      options.tune = 'ssim';
    } else if (config.contentHint === 'motion') {
      // Motion content: use film tune (default video optimization)
      options.tune = 'film';
    }
  }
}

/**
 * Build complete encoder options for a given codec
 */
export function buildEncoderOptions(
  config: VideoEncoderBackendConfig,
  codecName: string,
  inputPixelFormat: AVPixelFormat,
  timeBase: Rational,
  hardware: HardwareContext | null
): EncoderOptions {
  const framerate = config.framerate ?? DEFAULT_FRAMERATE;
  const gopSize = Math.max(1, framerate);
  const options: Record<string, string | number> = {};
  const isVpCodec = codecName === 'vp8' || codecName === 'vp9';
  const isAv1 = codecName === 'av1';
  const hwType = hardware?.deviceTypeName;
  const qualityOverrides = getQualityConfig(codecName);

  // Codec-specific options
  if (isVpCodec) {
    configureVpxOptions(options, config);
  } else if (isAv1) {
    configureSvtAv1Options(options, config);
  } else {
    configureX26xOptions(options, config, hwType);
  }

  // Quality mode
  if (qualityOverrides.crf !== undefined) {
    options.crf = String(qualityOverrides.crf);
  } else if (config.bitrateMode === 'quantizer') {
    const crf = CRF_DEFAULTS[codecName as keyof typeof CRF_DEFAULTS];
    if (crf) {
      options.crf = String(crf);
    }
  }

  // Explicit preset overrides codec defaults when supported
  // Note: Different encoders use different preset names:
  // - x264/x265: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
  // - NVENC: p1-p7 (or fast, medium, slow)
  // - QSV: veryfast, faster, fast, medium, slow, slower, veryslow
  // We only apply user preset if no hardware (software encoder) to avoid compatibility issues
  if (qualityOverrides.preset && !hwType) {
    options.preset = qualityOverrides.preset;
  }

  // Bitrate (required for VP/AV1)
  let bitrate = config.bitrate;
  if (!bitrate && (isVpCodec || isAv1)) {
    bitrate = DEFAULT_VP_BITRATE;
  }

  return {
    type: 'video' as const,
    width: config.width,
    height: config.height,
    pixelFormat: inputPixelFormat,
    timeBase,
    frameRate: new Rational(framerate, 1),
    bitrate,
    gopSize,
    maxBFrames: config.latencyMode === 'realtime' ? 0 : undefined,
    hardware: hardware ?? undefined,
    options,
  };
}
