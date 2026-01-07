/**
 * Codec description utilities for H.264/HEVC
 *
 * Handles extraction of parameter sets (SPS/PPS/VPS) from encoded packets
 * and builds decoder configuration records (AVCC/HVCC) for MP4 containers.
 */

import {
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
} from '../../../../utils/hevc.js';
import {
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
  convertAnnexBToAvcc,
} from '../../../../utils/avc.js';
import { createLogger } from '../../../../utils/logger.js';

const logger = createLogger('codec-description');

export interface CodecDescriptionResult {
  /** The codec description (AVCC for H.264, HVCC for HEVC) */
  description: Buffer | null;
  /** The frame data (possibly converted to length-prefixed format) */
  frameData: Buffer;
}

/**
 * Process H.264 packet: extract AVCC description and convert to length-prefixed format
 */
export function processAvcPacket(
  packetData: Buffer | Uint8Array,
  isKeyFrame: boolean,
  existingDescription: Buffer | null,
  outputFormat: 'annexb' | 'mp4'
): CodecDescriptionResult {
  let description: Buffer | null = existingDescription;
  let frameData: Buffer = Buffer.from(packetData) as Buffer;

  // Extract SPS/PPS from first keyframe to build AVCC description
  if (isKeyFrame && !description) {
    try {
      const { sps, pps } = extractAvcParameterSetsFromAnnexB(packetData);
      if (sps.length > 0 && pps.length > 0) {
        description = Buffer.from(buildAvcDecoderConfig(sps, pps, 4)) as Buffer;
        logger.debug(`Built AVCC description: ${description.length} bytes`);
      } else {
        logger.warn('H.264 keyframe missing parameter sets (SPS/PPS)');
      }
    } catch (err) {
      logger.warn(`Failed to extract H.264 parameter sets: ${(err as Error).message}`);
    }
  }

  // Convert Annex B to length-prefixed format for MP4
  if (outputFormat !== 'annexb') {
    frameData = convertAnnexBToAvcc(packetData, 4) as Buffer;
    logger.debug(`Converted H.264 frame to length-prefixed: ${packetData.length} -> ${frameData.length} bytes`);
  }

  return { description, frameData };
}

/**
 * Process HEVC packet: extract HVCC description and convert to length-prefixed format
 */
export function processHevcPacket(
  packetData: Buffer | Uint8Array,
  isKeyFrame: boolean,
  existingDescription: Buffer | null,
  outputFormat: 'annexb' | 'mp4'
): CodecDescriptionResult {
  let description: Buffer | null = existingDescription;
  let frameData: Buffer = Buffer.from(packetData) as Buffer;

  // Extract VPS/SPS/PPS from first keyframe to build HVCC description
  if (isKeyFrame && !description) {
    try {
      const { vps, sps, pps } = extractHevcParameterSetsFromAnnexB(packetData);
      if (vps.length > 0 && sps.length > 0 && pps.length > 0) {
        description = Buffer.from(buildHvccDecoderConfig(vps, sps, pps, 4)) as Buffer;
        logger.debug(`Built HVCC description: ${description.length} bytes`);
      } else {
        logger.warn('HEVC keyframe missing parameter sets (VPS/SPS/PPS)');
      }
    } catch (err) {
      logger.warn(`Failed to extract HEVC parameter sets: ${(err as Error).message}`);
    }
  }

  // Convert Annex B to length-prefixed format for MP4
  if (outputFormat !== 'annexb') {
    frameData = convertAnnexBToHvcc(packetData, 4) as Buffer;
    logger.debug(`Converted HEVC frame to length-prefixed: ${packetData.length} -> ${frameData.length} bytes`);
  }

  return { description, frameData };
}

/**
 * Process an encoded packet, handling codec-specific description extraction
 * and format conversion based on codec type
 */
export function processEncodedPacket(
  packetData: Buffer | Uint8Array,
  isKeyFrame: boolean,
  codecType: 'avc' | 'hevc' | 'other',
  existingDescription: Buffer | null,
  outputFormat: 'annexb' | 'mp4'
): CodecDescriptionResult {
  if (codecType === 'avc') {
    return processAvcPacket(packetData, isKeyFrame, existingDescription, outputFormat);
  }

  if (codecType === 'hevc') {
    return processHevcPacket(packetData, isKeyFrame, existingDescription, outputFormat);
  }

  // For other codecs (VP8, VP9, AV1), no conversion needed
  return {
    description: existingDescription,
    frameData: Buffer.from(packetData),
  };
}
