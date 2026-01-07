/**
 * Audio encoder options building utilities
 *
 * Builds codec-specific encoder options for Opus, AAC, FLAC, Vorbis, and PCM codecs
 */

import type { Rational } from 'node-av/lib';
import {
  AV_SAMPLE_FMT_FLTP,
  AV_SAMPLE_FMT_S16,
  AV_SAMPLE_FMT_FLT,
  AV_SAMPLE_FMT_U8,
  AV_SAMPLE_FMT_S32,
  type AVSampleFormat,
} from 'node-av/constants';

import type { AudioEncoderBackendConfig } from '../../../types.js';
import { OPUS_SAMPLE_RATE, getChannelLayout } from './index.js';

/** Channel layout object for FFmpeg */
export interface ChannelLayout {
  nbChannels: number;
  order: number;
  mask: bigint;
}

export interface AudioEncoderOptions {
  type: 'audio';
  sampleRate: number;
  channelLayout: ChannelLayout;
  sampleFormat: AVSampleFormat;
  timeBase: Rational;
  bitrate?: number;
  options: Record<string, string | number>;
}

/**
 * Get the required sample format for a codec
 */
export function getCodecSampleFormat(codecBase: string): AVSampleFormat {
  if (codecBase === 'opus') {
    // libopus only supports s16 or flt (interleaved)
    return AV_SAMPLE_FMT_FLT;
  }
  if (codecBase === 'vorbis') {
    return AV_SAMPLE_FMT_FLTP;
  }
  if (codecBase === 'flac' || codecBase === 'pcm-s16') {
    // flac encoder requires interleaved s16 or s32
    return AV_SAMPLE_FMT_S16;
  }
  if (codecBase === 'pcm-s24' || codecBase === 'pcm-s32') {
    return AV_SAMPLE_FMT_S32;
  }
  if (codecBase === 'pcm-u8') {
    return AV_SAMPLE_FMT_U8;
  }
  if (codecBase === 'ulaw' || codecBase === 'alaw') {
    return AV_SAMPLE_FMT_S16;
  }
  // Most codecs work with float planar (aac, etc.)
  return AV_SAMPLE_FMT_FLTP;
}

/**
 * Configure Opus-specific encoder options
 */
export function configureOpusOptions(
  options: Record<string, string | number>,
  config: AudioEncoderBackendConfig
): void {
  const opusConfig = config.opus;
  const isRealtime = config.latencyMode === 'realtime';
  const isConstantBitrate = config.bitrateMode === 'constant';
  const isVariableBitrate = config.bitrateMode === 'variable';

  // Application mode: explicit application takes precedence, then signal hint, then latency mode default
  let application: string;
  if (opusConfig?.application !== undefined) {
    application = opusConfig.application;
  } else if (opusConfig?.signal !== undefined) {
    // Map WebCodecs signal hint to libopus application mode
    application = opusConfig.signal === 'voice' ? 'voip' : 'audio';
  } else {
    application = isRealtime ? 'voip' : 'audio';
  }
  options.application = application;

  // Frame duration
  if (opusConfig?.frameDuration !== undefined) {
    options.frame_duration = String(opusConfig.frameDuration / 1000);
  } else if (isRealtime) {
    options.frame_duration = '10';
  }

  // VBR control
  if (isConstantBitrate) {
    options.vbr = 'off';
  } else if (isVariableBitrate) {
    options.vbr = 'on';
  }

  // Packet loss percentage for FEC
  if (opusConfig?.packetlossperc !== undefined) {
    options.packet_loss = String(opusConfig.packetlossperc);
  }

  // In-band FEC
  if (opusConfig?.useinbandfec !== undefined) {
    options.fec = opusConfig.useinbandfec ? '1' : '0';
  }

  // Discontinuous transmission
  if (opusConfig?.usedtx !== undefined) {
    options.dtx = opusConfig.usedtx ? '1' : '0';
  }

  // Complexity (0-10)
  if (opusConfig?.complexity !== undefined) {
    options.compression_level = String(opusConfig.complexity);
  }
}

/**
 * Configure AAC-specific encoder options
 */
export function configureAacOptions(
  options: Record<string, string | number>,
  config: AudioEncoderBackendConfig
): void {
  const isVariableBitrate = config.bitrateMode === 'variable';

  if (isVariableBitrate && !config.bitrate) {
    // VBR mode with quality-based encoding
    options.global_quality = 4;
  }
}

/**
 * Build complete encoder options for a given audio codec
 */
export function buildAudioEncoderOptions(
  config: AudioEncoderBackendConfig,
  timeBase: Rational
): AudioEncoderOptions {
  const codecBase = config.codec.split('.')[0].toLowerCase();
  const isOpus = codecBase === 'opus';
  const isFlac = codecBase === 'flac';

  const sampleFormat = getCodecSampleFormat(codecBase);
  const options: Record<string, string | number> = {};

  // Codec-specific options
  if (isOpus) {
    configureOpusOptions(options, config);
  } else if (codecBase === 'aac' || codecBase === 'mp4a') {
    configureAacOptions(options, config);
  }

  // Frame size configuration for specific codecs
  if (isFlac) {
    options.frame_size = '1024';
  }

  return {
    type: 'audio' as const,
    sampleRate: isOpus ? OPUS_SAMPLE_RATE : config.sampleRate,
    channelLayout: getChannelLayout(config.numberOfChannels),
    sampleFormat,
    timeBase,
    bitrate: config.bitrate,
    options,
  };
}
