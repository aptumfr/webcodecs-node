/**
 * AudioDecoder configuration validation and support checking
 */

import { AUDIO_DECODER_CODEC_MAP, AUDIO_OUTPUT_FORMAT_MAP } from '../../codec-utils/audio-codecs.js';
import { getCodecBase } from '../../utils/codec-cache.js';
import type { AudioDecoderConfig, AudioDecoderSupport } from './types.js';

/**
 * Validate required AudioDecoderConfig fields
 */
export function validateRequiredFields(config: AudioDecoderConfig): void {
  if (!config || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }
  if (config.codec === undefined || config.codec === null) {
    throw new TypeError("Failed to read the 'codec' property from 'AudioDecoderConfig': Required member is undefined.");
  }
  if (typeof config.codec !== 'string' || config.codec === '') {
    throw new TypeError('codec must be a non-empty string');
  }
  if (config.sampleRate === undefined || config.sampleRate === null) {
    throw new TypeError("Failed to read the 'sampleRate' property from 'AudioDecoderConfig': Required member is undefined.");
  }
  if (typeof config.sampleRate !== 'number' || !Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
    throw new TypeError('sampleRate must be a finite positive number');
  }
  if (config.numberOfChannels === undefined || config.numberOfChannels === null) {
    throw new TypeError("Failed to read the 'numberOfChannels' property from 'AudioDecoderConfig': Required member is undefined.");
  }
  if (typeof config.numberOfChannels !== 'number' || !Number.isFinite(config.numberOfChannels) || config.numberOfChannels <= 0 || !Number.isInteger(config.numberOfChannels)) {
    throw new TypeError('numberOfChannels must be a positive integer');
  }
}

/**
 * Validate description buffer is not detached
 */
export function validateDescription(config: AudioDecoderConfig): void {
  if (config.description !== undefined) {
    const desc = config.description;
    if (desc instanceof ArrayBuffer) {
      // Check if ArrayBuffer is detached (byteLength becomes 0)
      // Note: Can't distinguish between empty and detached without 'detached' property
      // In Node.js 20+, we can check the 'detached' property
      if ((desc as any).detached === true) {
        throw new TypeError('description buffer is detached');
      }
    } else if (ArrayBuffer.isView(desc)) {
      if ((desc.buffer as any).detached === true) {
        throw new TypeError('description buffer is detached');
      }
      // Also check for views that reference detached buffers
      if (desc.buffer.byteLength === 0 && desc.byteLength !== 0) {
        throw new TypeError('description buffer is detached');
      }
    }
  }
}

/**
 * Clone an AudioDecoderConfig per WebCodecs spec
 */
export function cloneConfig(config: AudioDecoderConfig): AudioDecoderConfig {
  const clonedConfig: AudioDecoderConfig = {
    codec: config.codec,
    sampleRate: config.sampleRate,
    numberOfChannels: config.numberOfChannels,
  };

  // Copy description if provided (clone the buffer)
  if (config.description !== undefined) {
    const desc = config.description;
    if (desc instanceof ArrayBuffer) {
      clonedConfig.description = desc.slice(0) as ArrayBuffer;
    } else if (ArrayBuffer.isView(desc)) {
      // Create a new Uint8Array copy to ensure we have an ArrayBuffer
      const copy = new Uint8Array(desc.byteLength);
      copy.set(new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength));
      clonedConfig.description = copy.buffer;
    }
  }

  // Copy outputFormat if valid
  if (config.outputFormat !== undefined) {
    if (config.outputFormat in AUDIO_OUTPUT_FORMAT_MAP) {
      clonedConfig.outputFormat = config.outputFormat;
    } else {
      throw new TypeError(`Invalid outputFormat: ${config.outputFormat}`);
    }
  }

  return clonedConfig;
}

/**
 * Check if an AudioDecoderConfig is supported
 */
export async function checkConfigSupport(config: AudioDecoderConfig): Promise<AudioDecoderSupport> {
  // Validate required fields and types - throw TypeError for invalid types
  validateRequiredFields(config);

  // Validate description is not detached
  validateDescription(config);

  // Clone the config per WebCodecs spec (strip unknown fields)
  const clonedConfig = cloneConfig(config);

  const codecBase = getCodecBase(config.codec);

  // Opus with >2 channels requires description (mapping table)
  if (codecBase === 'opus' && config.numberOfChannels > 2 && config.description === undefined) {
    return { supported: false, config: clonedConfig };
  }

  const supported = codecBase in AUDIO_DECODER_CODEC_MAP || config.codec in AUDIO_DECODER_CODEC_MAP;

  return { supported, config: clonedConfig };
}
