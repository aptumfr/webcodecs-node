/**
 * Codec ID mapping utilities for audio decoding
 */

import {
  AV_CODEC_ID_AAC,
  AV_CODEC_ID_OPUS,
  AV_CODEC_ID_MP3,
  AV_CODEC_ID_FLAC,
  AV_CODEC_ID_VORBIS,
  AV_CODEC_ID_PCM_S16LE,
  AV_CODEC_ID_PCM_S24LE,
  AV_CODEC_ID_PCM_S32LE,
  AV_CODEC_ID_PCM_F32LE,
  AV_CODEC_ID_PCM_U8,
  AV_CODEC_ID_PCM_MULAW,
  AV_CODEC_ID_PCM_ALAW,
  type AVCodecID,
} from 'node-av/constants';

/**
 * Map codec string to FFmpeg AVCodecID
 */
export function mapCodecId(codec: string): AVCodecID | null {
  const codecBase = codec.split('.')[0].toLowerCase();
  switch (codecBase) {
    case 'mp4a':
    case 'aac':
      return AV_CODEC_ID_AAC;
    case 'opus':
      return AV_CODEC_ID_OPUS;
    case 'mp3':
      return AV_CODEC_ID_MP3;
    case 'flac':
      return AV_CODEC_ID_FLAC;
    case 'vorbis':
      return AV_CODEC_ID_VORBIS;
    case 'pcm-s16':
      return AV_CODEC_ID_PCM_S16LE;
    case 'pcm-s24':
      return AV_CODEC_ID_PCM_S24LE;
    case 'pcm-s32':
      return AV_CODEC_ID_PCM_S32LE;
    case 'pcm-f32':
      return AV_CODEC_ID_PCM_F32LE;
    case 'pcm-u8':
      return AV_CODEC_ID_PCM_U8;
    case 'ulaw':
      return AV_CODEC_ID_PCM_MULAW;
    case 'alaw':
      return AV_CODEC_ID_PCM_ALAW;
    default:
      return null;
  }
}
