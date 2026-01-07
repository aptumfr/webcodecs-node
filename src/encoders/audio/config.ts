/**
 * AudioEncoder configuration validation and support checking
 */

import { getCodecBase } from '../../utils/codec-cache.js';
import { AUDIO_ENCODER_CODEC_MAP } from '../../codec-utils/audio-codecs.js';
import type {
  AudioEncoderConfig,
  AudioEncoderSupport,
  OpusEncoderConfig,
  AacEncoderConfig,
} from './types.js';

/**
 * Validate required AudioEncoderConfig fields
 */
export function validateRequiredFields(config: AudioEncoderConfig): void {
  if (!config || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }
  if (config.codec === undefined || config.codec === null) {
    throw new TypeError("Failed to read the 'codec' property from 'AudioEncoderConfig': Required member is undefined.");
  }
  if (typeof config.codec !== 'string' || config.codec === '') {
    throw new TypeError('codec must be a non-empty string');
  }
  if (config.sampleRate === undefined || config.sampleRate === null) {
    throw new TypeError("Failed to read the 'sampleRate' property from 'AudioEncoderConfig': Required member is undefined.");
  }
  if (typeof config.sampleRate !== 'number' || !Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
    throw new TypeError('sampleRate must be a finite positive number');
  }
  if (config.numberOfChannels === undefined || config.numberOfChannels === null) {
    throw new TypeError("Failed to read the 'numberOfChannels' property from 'AudioEncoderConfig': Required member is undefined.");
  }
  if (typeof config.numberOfChannels !== 'number' || !Number.isFinite(config.numberOfChannels) || config.numberOfChannels <= 0 || !Number.isInteger(config.numberOfChannels)) {
    throw new TypeError('numberOfChannels must be a positive integer');
  }
}

/**
 * Validate optional AudioEncoderConfig fields
 */
export function validateOptionalFields(config: AudioEncoderConfig): void {
  if (config.bitrate !== undefined && (typeof config.bitrate !== 'number' || !Number.isFinite(config.bitrate) || config.bitrate <= 0)) {
    throw new TypeError('bitrate must be a finite positive number');
  }
  if (config.bitrateMode !== undefined && !['constant', 'variable'].includes(config.bitrateMode)) {
    throw new TypeError("bitrateMode must be 'constant' or 'variable'");
  }
  if (config.latencyMode !== undefined && !['quality', 'realtime'].includes(config.latencyMode)) {
    throw new TypeError("latencyMode must be 'quality' or 'realtime'");
  }
}

/**
 * Validate Opus-specific config per WebCodecs Opus codec registration
 * Returns false if config is unsupported (but valid)
 */
export function validateOpusConfig(config: AudioEncoderConfig): boolean {
  if (config.opus?.format !== undefined) {
    const format = config.opus.format as string; // Cast to handle runtime 'ogg' values
    if (format === 'ogg') {
      // 'ogg' format requests Ogg-encapsulated output, but encoders produce raw packets.
      // Ogg containerization is handled by the muxer, not the encoder.
      throw new TypeError("opus.format 'ogg' is not supported at encoder level - use 'opus' format and an Ogg muxer");
    }
    if (format !== 'opus') {
      throw new TypeError("opus.format must be 'opus'");
    }
  }
  if (config.opus?.packetlossperc !== undefined) {
    if (typeof config.opus.packetlossperc !== 'number' || config.opus.packetlossperc < 0 || config.opus.packetlossperc > 100) {
      throw new TypeError('opus.packetlossperc must be a number between 0 and 100');
    }
  }
  const validFrameDurations = [2500, 5000, 10000, 20000, 40000, 60000, 80000, 100000, 120000];
  if (config.opus?.frameDuration !== undefined) {
    if (!validFrameDurations.includes(config.opus.frameDuration)) {
      throw new TypeError(`opus.frameDuration must be one of: ${validFrameDurations.join(', ')}`);
    }
  }
  if (config.opus?.complexity !== undefined) {
    if (typeof config.opus.complexity !== 'number' || config.opus.complexity < 0 || config.opus.complexity > 10) {
      throw new TypeError('opus.complexity must be a number between 0 and 10');
    }
  }
  if (config.opus?.application !== undefined && !['voip', 'audio', 'lowdelay'].includes(config.opus.application)) {
    throw new TypeError("opus.application must be 'voip', 'audio', or 'lowdelay'");
  }
  if (config.opus?.signal !== undefined && !['auto', 'music', 'voice'].includes(config.opus.signal)) {
    throw new TypeError("opus.signal must be 'auto', 'music', or 'voice'");
  }
  // Validate Opus channel count (1-255 per RFC 6716)
  if (config.numberOfChannels > 255) {
    return false;
  }
  // Validate Opus bitrate bounds (6kbps - 510kbps per Opus spec)
  if (config.bitrate !== undefined) {
    if (config.bitrate < 6000 || config.bitrate > 510000) {
      return false;
    }
  }
  return true;
}

/**
 * Validate AAC-specific config
 */
export function validateAacConfig(config: AudioEncoderConfig): void {
  if (config.aac?.format !== undefined && !['aac', 'adts'].includes(config.aac.format)) {
    throw new TypeError("aac.format must be 'aac' or 'adts'");
  }
}

/**
 * Clone an AudioEncoderConfig per WebCodecs spec
 */
export function cloneConfig(config: AudioEncoderConfig): AudioEncoderConfig {
  const codecBase = getCodecBase(config.codec);

  const clonedConfig: AudioEncoderConfig = {
    codec: config.codec,
    sampleRate: config.sampleRate,
    numberOfChannels: config.numberOfChannels,
  };

  // Copy optional properties if present
  if (config.bitrate !== undefined) clonedConfig.bitrate = config.bitrate;
  if (config.bitrateMode !== undefined) clonedConfig.bitrateMode = config.bitrateMode;
  if (config.latencyMode !== undefined) clonedConfig.latencyMode = config.latencyMode;
  if (config.format !== undefined) clonedConfig.format = config.format;

  // Clone Opus config with defaults per WebCodecs Opus codec registration
  if (codecBase === 'opus') {
    const opusConfig: OpusEncoderConfig = {
      format: config.opus?.format ?? 'opus',
      frameDuration: config.opus?.frameDuration ?? 20000,
      application: config.opus?.application ?? 'audio',
      packetlossperc: config.opus?.packetlossperc ?? 0,
      useinbandfec: config.opus?.useinbandfec ?? false,
      usedtx: config.opus?.usedtx ?? false,
      signal: config.opus?.signal ?? 'auto',
      complexity: config.opus?.complexity ?? 10,
    };
    clonedConfig.opus = opusConfig;
  }

  // Clone AAC config (strip unknown fields)
  if (config.aac) {
    const aacConfig: AacEncoderConfig = {};
    if (config.aac.format !== undefined) aacConfig.format = config.aac.format;
    clonedConfig.aac = aacConfig;
  }

  return clonedConfig;
}

/**
 * Check if an AudioEncoderConfig is supported
 */
export async function checkConfigSupport(config: AudioEncoderConfig): Promise<AudioEncoderSupport> {
  // Validate required fields
  validateRequiredFields(config);

  // Validate optional fields
  validateOptionalFields(config);

  const codecBase = getCodecBase(config.codec);

  // Validate Opus-specific config
  if (codecBase === 'opus') {
    const opusSupported = validateOpusConfig(config);
    if (!opusSupported) {
      return { supported: false, config };
    }
  }

  // Validate AAC-specific config
  validateAacConfig(config);

  // Clone the config per WebCodecs spec
  const clonedConfig = cloneConfig(config);

  const supported = codecBase in AUDIO_ENCODER_CODEC_MAP || config.codec in AUDIO_ENCODER_CODEC_MAP;

  return { supported, config: clonedConfig };
}
