/**
 * Pixel format mapping utilities for video decoding
 */

import {
  AV_PIX_FMT_BGRA,
  AV_PIX_FMT_BGR0,
  AV_PIX_FMT_NV12,
  AV_PIX_FMT_RGBA,
  AV_PIX_FMT_RGB0,
  AV_PIX_FMT_YUV420P,
  AV_PIX_FMT_YUV422P,
  AV_PIX_FMT_YUV444P,
  AV_PIX_FMT_YUVA420P,
  AV_PIX_FMT_YUV420P10LE,
  AV_PIX_FMT_YUV422P10LE,
  AV_PIX_FMT_YUV444P10LE,
  AV_PIX_FMT_P010LE,
  type AVPixelFormat,
} from 'node-av/constants';

/**
 * Map WebCodecs pixel format string to AVPixelFormat
 */
export function mapPixelFormat(format: string): AVPixelFormat {
  const fmt = format.toUpperCase();
  switch (fmt) {
    case 'I420':
    case 'YUV420P':
      return AV_PIX_FMT_YUV420P;
    case 'I420A':
    case 'YUVA420P':
      return AV_PIX_FMT_YUVA420P;
    case 'I422':
    case 'YUV422P':
      return AV_PIX_FMT_YUV422P;
    case 'I444':
    case 'YUV444P':
      return AV_PIX_FMT_YUV444P;
    case 'NV12':
      return AV_PIX_FMT_NV12;
    case 'BGRA':
      return AV_PIX_FMT_BGRA;
    case 'BGRX':
      return AV_PIX_FMT_BGR0;
    case 'RGBA':
      return AV_PIX_FMT_RGBA;
    case 'RGBX':
      return AV_PIX_FMT_RGB0;
    // 10-bit formats
    case 'I420P10':
    case 'YUV420P10LE':
    case 'YUV420P10':
      return AV_PIX_FMT_YUV420P10LE;
    case 'I422P10':
    case 'YUV422P10LE':
    case 'YUV422P10':
      return AV_PIX_FMT_YUV422P10LE;
    case 'I444P10':
    case 'YUV444P10LE':
    case 'YUV444P10':
      return AV_PIX_FMT_YUV444P10LE;
    case 'P010':
    case 'P010LE':
      return AV_PIX_FMT_P010LE;
    default:
      return AV_PIX_FMT_YUV420P;
  }
}

/**
 * Map AVPixelFormat to FFmpeg format name string
 */
export function pixelFormatToFFmpegName(fmt: AVPixelFormat): string {
  switch (fmt) {
    case AV_PIX_FMT_BGRA:
      return 'bgra';
    case AV_PIX_FMT_BGR0:
      return 'bgr0';
    case AV_PIX_FMT_RGBA:
      return 'rgba';
    case AV_PIX_FMT_RGB0:
      return 'rgb0';
    case AV_PIX_FMT_NV12:
      return 'nv12';
    case AV_PIX_FMT_YUV422P:
      return 'yuv422p';
    case AV_PIX_FMT_YUV444P:
      return 'yuv444p';
    case AV_PIX_FMT_YUVA420P:
      return 'yuva420p';
    // 10-bit formats
    case AV_PIX_FMT_YUV420P10LE:
      return 'yuv420p10le';
    case AV_PIX_FMT_YUV422P10LE:
      return 'yuv422p10le';
    case AV_PIX_FMT_YUV444P10LE:
      return 'yuv444p10le';
    case AV_PIX_FMT_P010LE:
      return 'p010le';
    case AV_PIX_FMT_YUV420P:
    default:
      return 'yuv420p';
  }
}
