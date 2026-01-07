/**
 * Audio codec description utilities
 *
 * Extracts and generates codec-specific description data (extradata)
 * for AAC, Opus, FLAC, and Vorbis codecs.
 */

import type { Encoder } from 'node-av/api';
import { createLogger } from '../../../../utils/logger.js';

const logger = createLogger('audio-codec-description');

/**
 * Generate OpusHead (Identification Header) per RFC 7845 Section 5.1
 * Used when FFmpeg doesn't provide extradata for Opus encoding
 */
export function generateOpusHead(
  channels: number,
  inputSampleRate: number
): Buffer {
  const sampleRate = inputSampleRate || 48000;

  // OpusHead structure:
  // - Magic Signature: "OpusHead" (8 bytes)
  // - Version: 1 (1 byte)
  // - Channel Count (1 byte)
  // - Pre-skip: samples to skip at start (2 bytes, LE) - 312 is typical for 48kHz
  // - Input Sample Rate (4 bytes, LE) - original sample rate
  // - Output Gain: 0 dB (2 bytes, LE)
  // - Channel Mapping Family (1 byte) - 0 for mono/stereo
  const preSkip = 312;
  const outputGain = 0;
  const mappingFamily = channels <= 2 ? 0 : 1;

  let headerSize = 19; // Base header size for mapping family 0
  if (mappingFamily > 0) {
    headerSize += 2 + channels;
  }

  const header = Buffer.alloc(headerSize);
  let offset = 0;

  // Magic Signature
  header.write('OpusHead', offset);
  offset += 8;

  // Version
  header.writeUInt8(1, offset);
  offset += 1;

  // Channel Count
  header.writeUInt8(channels, offset);
  offset += 1;

  // Pre-skip (little-endian)
  header.writeUInt16LE(preSkip, offset);
  offset += 2;

  // Input Sample Rate (little-endian)
  header.writeUInt32LE(sampleRate, offset);
  offset += 4;

  // Output Gain (little-endian)
  header.writeInt16LE(outputGain, offset);
  offset += 2;

  // Channel Mapping Family
  header.writeUInt8(mappingFamily, offset);
  offset += 1;

  // For mapping family > 0, add stream info and channel mapping
  if (mappingFamily > 0) {
    const streamCount = channels > 2 ? Math.ceil(channels / 2) : 1;
    const coupledCount = channels > 2 ? Math.floor(channels / 2) : 0;
    header.writeUInt8(streamCount, offset);
    offset += 1;
    header.writeUInt8(coupledCount, offset);
    offset += 1;
    // Channel mapping (identity mapping)
    for (let i = 0; i < channels; i++) {
      header.writeUInt8(i, offset);
      offset += 1;
    }
  }

  return header;
}

/**
 * Build FLAC description from extradata
 * Prepends 'fLaC' magic and STREAMINFO block header
 */
export function buildFlacDescription(extraData: Uint8Array): Buffer {
  const magic = Buffer.from('fLaC');
  // STREAMINFO block header: type (0x00) | last-block flag (0x80)
  const blockHeader = Buffer.from([0x80, 0x00, 0x00, extraData.length]);
  return Buffer.concat([magic, blockHeader, Buffer.from(extraData)]);
}

export interface CodecDescriptionContext {
  codec: string;
  numberOfChannels: number;
  inputSampleRate: number;
}

/**
 * Extract codec description (extradata) from encoder
 *
 * Different codecs have different description formats:
 * - AAC: AudioSpecificConfig
 * - Opus: OpusHead (Identification Header)
 * - FLAC: fLaC magic + STREAMINFO block
 * - Vorbis: identification + comment + setup headers
 */
export function extractCodecDescription(
  encoder: Encoder,
  context: CodecDescriptionContext
): Buffer | null {
  const codecBase = context.codec.split('.')[0].toLowerCase();

  try {
    const ctx = encoder.getCodecContext();
    if (!ctx) return null;

    const extraData = ctx.extraData;

    if (codecBase === 'mp4a' || codecBase === 'aac') {
      if (!extraData || extraData.length === 0) return null;
      // AAC: extradata contains AudioSpecificConfig
      const description = Buffer.from(extraData);
      logger.debug(`AAC description from extradata: ${description.length} bytes`);
      return description;
    }

    if (codecBase === 'opus') {
      // Opus: extradata contains OpusHead structure
      if (extraData && extraData.length > 0) {
        const description = Buffer.from(extraData);
        logger.debug(`Opus description from extradata: ${description.length} bytes`);
        return description;
      }
      // Generate OpusHead manually if FFmpeg didn't provide it
      const description = generateOpusHead(context.numberOfChannels, context.inputSampleRate);
      logger.debug(`Opus description generated: ${description.length} bytes`);
      return description;
    }

    if (codecBase === 'flac') {
      if (!extraData || extraData.length === 0) return null;
      const description = buildFlacDescription(extraData);
      logger.debug(`FLAC description: ${description.length} bytes`);
      return description;
    }

    if (codecBase === 'vorbis') {
      if (!extraData || extraData.length === 0) return null;
      // Vorbis: extradata contains all three headers
      const description = Buffer.from(extraData);
      logger.debug(`Vorbis description: ${description.length} bytes`);
      return description;
    }

    return null;
  } catch (err) {
    logger.debug(`Failed to extract codec description: ${err}`);
    return null;
  }
}
