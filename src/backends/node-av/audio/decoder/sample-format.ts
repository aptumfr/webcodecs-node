/**
 * Sample format mapping utilities for audio decoding
 */

import {
  AV_SAMPLE_FMT_FLT,
  AV_SAMPLE_FMT_FLTP,
  AV_SAMPLE_FMT_S16,
  AV_SAMPLE_FMT_S16P,
  AV_SAMPLE_FMT_S32,
  AV_SAMPLE_FMT_S32P,
  AV_SAMPLE_FMT_U8,
  AV_SAMPLE_FMT_U8P,
  type AVSampleFormat,
} from 'node-av/constants';

import type { AudioSampleFormat } from '../../../../types/audio.js';

/**
 * Map WebCodecs AudioSampleFormat to FFmpeg AVSampleFormat
 */
export function mapSampleFormat(format: AudioSampleFormat): AVSampleFormat {
  switch (format) {
    case 'u8':
      return AV_SAMPLE_FMT_U8;
    case 'u8-planar':
      return AV_SAMPLE_FMT_U8P;
    case 's16':
      return AV_SAMPLE_FMT_S16;
    case 's16-planar':
      return AV_SAMPLE_FMT_S16P;
    case 's32':
      return AV_SAMPLE_FMT_S32;
    case 's32-planar':
      return AV_SAMPLE_FMT_S32P;
    case 'f32':
      return AV_SAMPLE_FMT_FLT;
    case 'f32-planar':
      return AV_SAMPLE_FMT_FLTP;
    default:
      return AV_SAMPLE_FMT_FLT;
  }
}

/**
 * Map AVSampleFormat to FFmpeg format name string
 */
export function sampleFormatToFFmpegName(fmt: AVSampleFormat): string {
  switch (fmt) {
    case AV_SAMPLE_FMT_U8:
      return 'u8';
    case AV_SAMPLE_FMT_U8P:
      return 'u8p';
    case AV_SAMPLE_FMT_S16:
      return 's16';
    case AV_SAMPLE_FMT_S16P:
      return 's16p';
    case AV_SAMPLE_FMT_S32:
      return 's32';
    case AV_SAMPLE_FMT_S32P:
      return 's32p';
    case AV_SAMPLE_FMT_FLTP:
      return 'fltp';
    case AV_SAMPLE_FMT_FLT:
    default:
      return 'flt';
  }
}
