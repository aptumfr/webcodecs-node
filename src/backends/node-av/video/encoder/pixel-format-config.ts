/**
 * Pixel format configuration for encoding
 *
 * Determines the optimal encoder pixel format based on:
 * - Input pixel format (8-bit, 10-bit, alpha)
 * - Codec capabilities (VP9 alpha, HEVC 10-bit, etc.)
 * - Hardware vs software encoding
 */

import {
  AV_PIX_FMT_NV12,
  AV_PIX_FMT_RGBA,
  AV_PIX_FMT_BGRA,
  AV_PIX_FMT_YUV420P,
  AV_PIX_FMT_YUVA420P,
  AV_PIX_FMT_YUV420P10LE,
  AV_PIX_FMT_YUV422P10LE,
  AV_PIX_FMT_YUV444P10LE,
  AV_PIX_FMT_P010LE,
  type AVPixelFormat,
} from 'node-av/constants';

import { createLogger } from '../../../../utils/logger.js';

const logger = createLogger('pixel-format-config');

export interface PixelFormatConfig {
  /** The pixel format the encoder should use */
  encoderPixelFormat: AVPixelFormat;
  /** Whether format conversion is needed */
  needsFormatConversion: boolean;
  /** Target format name for filter chain (e.g., 'nv12', 'yuv420p') */
  targetFormatName: string;
}

/**
 * Check if pixel format has alpha channel
 */
export function hasAlphaChannel(pixelFormat: AVPixelFormat): boolean {
  return (
    pixelFormat === AV_PIX_FMT_YUVA420P ||
    pixelFormat === AV_PIX_FMT_RGBA ||
    pixelFormat === AV_PIX_FMT_BGRA
  );
}

/**
 * Check if pixel format is 10-bit
 */
export function is10BitFormat(pixelFormat: AVPixelFormat): boolean {
  return (
    pixelFormat === AV_PIX_FMT_YUV420P10LE ||
    pixelFormat === AV_PIX_FMT_YUV422P10LE ||
    pixelFormat === AV_PIX_FMT_YUV444P10LE ||
    pixelFormat === AV_PIX_FMT_P010LE
  );
}

/**
 * Check if codec supports alpha channel encoding
 * Only VP9 software supports alpha (via YUVA420P)
 */
export function codecSupportsAlpha(codecName: string, isHardware: boolean): boolean {
  return codecName === 'vp9' && !isHardware;
}

/**
 * Check if codec supports 10-bit encoding
 */
export function codecSupports10Bit(codecName: string): boolean {
  return codecName === 'hevc' || codecName === 'vp9' || codecName === 'av1';
}

/**
 * Get the format name string for filter chains
 */
function getFormatName(pixelFormat: AVPixelFormat): string {
  switch (pixelFormat) {
    case AV_PIX_FMT_NV12:
      return 'nv12';
    case AV_PIX_FMT_YUVA420P:
      return 'yuva420p';
    case AV_PIX_FMT_YUV420P10LE:
      return 'yuv420p10le';
    case AV_PIX_FMT_P010LE:
      return 'p010le';
    default:
      return 'yuv420p';
  }
}

/**
 * Configure the optimal encoder pixel format
 *
 * Determines the best pixel format based on input format, codec capabilities,
 * and hardware/software mode. Logs warnings for format conversions that lose quality.
 */
export function configureEncoderPixelFormat(
  inputPixelFormat: AVPixelFormat,
  codecName: string,
  isHardware: boolean,
  keepAlpha: boolean
): PixelFormatConfig {
  const inputHasAlpha = hasAlphaChannel(inputPixelFormat);
  const inputIs10Bit = is10BitFormat(inputPixelFormat);
  const canEncodeAlpha = codecSupportsAlpha(codecName, isHardware);
  const canEncode10Bit = codecSupports10Bit(codecName);

  let encoderPixelFormat: AVPixelFormat;

  if (keepAlpha && inputHasAlpha && canEncodeAlpha) {
    // VP9 software with alpha
    encoderPixelFormat = AV_PIX_FMT_YUVA420P;
    logger.debug(`Alpha channel will be preserved (codec: ${codecName})`);
  } else if (inputIs10Bit && canEncode10Bit && !isHardware) {
    // 10-bit software encoding
    encoderPixelFormat = AV_PIX_FMT_YUV420P10LE;
    logger.debug(`10-bit encoding enabled (codec: ${codecName})`);

    // Warn about chroma subsampling changes
    if (inputPixelFormat === AV_PIX_FMT_YUV422P10LE) {
      logger.warn(
        `10-bit 4:2:2 (I422P10) input will be downconverted to 4:2:0 (I420P10) - chroma resolution reduced`
      );
    } else if (inputPixelFormat === AV_PIX_FMT_YUV444P10LE) {
      logger.warn(
        `10-bit 4:4:4 (I444P10) input will be downconverted to 4:2:0 (I420P10) - chroma resolution reduced`
      );
    }

    if (keepAlpha && inputHasAlpha) {
      logger.warn(`Alpha requested with 10-bit input but 10-bit alpha not supported - discarding alpha`);
    }
  } else if (inputIs10Bit && isHardware) {
    // Hardware 10-bit: use P010 (semi-planar 10-bit)
    encoderPixelFormat = AV_PIX_FMT_P010LE;
    logger.debug(`Hardware 10-bit encoding using P010`);
    if (keepAlpha && inputHasAlpha) {
      logger.warn(`Alpha requested but hardware encoders don't support alpha - discarding`);
    }
  } else if (isHardware) {
    // Hardware 8-bit: NV12
    encoderPixelFormat = AV_PIX_FMT_NV12;
    if (keepAlpha && inputHasAlpha) {
      logger.warn(`Alpha requested but hardware encoders don't support alpha - discarding`);
    }
  } else {
    // Software 8-bit: YUV420P
    encoderPixelFormat = AV_PIX_FMT_YUV420P;
    if (keepAlpha && inputHasAlpha) {
      logger.warn(`Alpha requested but ${codecName} doesn't support alpha - discarding`);
    }
    if (inputIs10Bit) {
      logger.warn(`10-bit input but ${codecName} doesn't support 10-bit - downconverting to 8-bit`);
    }
  }

  return {
    encoderPixelFormat,
    needsFormatConversion: inputPixelFormat !== encoderPixelFormat,
    targetFormatName: getFormatName(encoderPixelFormat),
  };
}
