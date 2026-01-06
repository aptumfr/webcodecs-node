/**
 * Image decoder constants
 */

import {
  AV_CODEC_ID_PNG,
  AV_CODEC_ID_MJPEG,
  AV_CODEC_ID_WEBP,
  AV_CODEC_ID_GIF,
  AV_CODEC_ID_BMP,
  AV_CODEC_ID_TIFF,
  AV_CODEC_ID_AV1,
  type AVCodecID,
} from 'node-av/constants';

/** MIME type to AVCodecID mapping */
export const MIME_TO_CODEC_ID: Record<string, AVCodecID> = {
  'image/png': AV_CODEC_ID_PNG,
  'image/apng': AV_CODEC_ID_PNG,
  'image/jpeg': AV_CODEC_ID_MJPEG,
  'image/jpg': AV_CODEC_ID_MJPEG,
  'image/webp': AV_CODEC_ID_WEBP,
  'image/gif': AV_CODEC_ID_GIF,
  'image/bmp': AV_CODEC_ID_BMP,
  'image/tiff': AV_CODEC_ID_TIFF,
  'image/avif': AV_CODEC_ID_AV1,
};

/**
 * Formats that require Demuxer for proper decoding (container formats)
 * Note: WebP is excluded because FFmpeg's webp demuxer doesn't support ANIM/ANMF
 */
export const DEMUXER_FORMATS = ['image/gif', 'image/apng', 'image/avif'];

/** Default frame duration in microseconds (100ms) */
export const DEFAULT_FRAME_DURATION = 100000;
