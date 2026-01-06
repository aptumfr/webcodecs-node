/**
 * Codec ID mapping utilities for video decoding
 */

import {
  AV_CODEC_ID_H264,
  AV_CODEC_ID_HEVC,
  AV_CODEC_ID_VP8,
  AV_CODEC_ID_VP9,
  AV_CODEC_ID_AV1,
  type AVCodecID,
} from 'node-av/constants';

/**
 * Map codec string to FFmpeg AVCodecID
 */
export function mapCodecId(codec: string): AVCodecID | null {
  switch (codec.toLowerCase()) {
    case 'h264':
      return AV_CODEC_ID_H264;
    case 'hevc':
    case 'h265':
      return AV_CODEC_ID_HEVC;
    case 'vp8':
      return AV_CODEC_ID_VP8;
    case 'vp9':
      return AV_CODEC_ID_VP9;
    case 'av1':
      return AV_CODEC_ID_AV1;
    default:
      return null;
  }
}
