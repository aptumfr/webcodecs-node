/**
 * Packet drain utilities for video encoding
 *
 * Handles draining encoded packets from the encoder
 * and converting them to EncodedFrame output format.
 */

import type { Encoder } from 'node-av/api';
import { AV_PKT_FLAG_KEY } from 'node-av/constants';

import type { EncodedFrame } from '../../../types.js';
import { createLogger } from '../../../../utils/logger.js';
import { processEncodedPacket } from './codec-description.js';
import { ptsToMicroseconds } from './timestamp.js';

const logger = createLogger('encoder-drain');

export interface DrainContext {
  /** Current codec description (AVCC/HVCC) */
  codecDescription: Buffer | null;
  /** Whether this is AVC codec */
  isAvcCodec: boolean;
  /** Whether this is HEVC codec */
  isHevcCodec: boolean;
  /** Output format (annexb or mp4) */
  outputFormat: 'annexb' | 'mp4';
  /** Fallback frame index for timestamp */
  frameIndex: number;
}

export interface DrainResult {
  /** Encoded frames extracted from packets */
  frames: EncodedFrame[];
  /** Updated codec description (may have been extracted from first keyframe) */
  codecDescription: Buffer | null;
}

/**
 * Drain all available packets from the encoder
 *
 * Converts packets to EncodedFrame format, extracting codec description
 * from the first keyframe if needed.
 */
export async function drainEncoderPackets(
  encoder: Encoder,
  context: DrainContext
): Promise<DrainResult> {
  const frames: EncodedFrame[] = [];
  let codecDescription = context.codecDescription;

  let packet = await encoder.receive();
  while (packet) {
    if (packet.data) {
      // Convert packet PTS from packet's timebase to microseconds
      let timestamp = context.frameIndex;
      if (packet.pts !== undefined) {
        timestamp = ptsToMicroseconds(packet.pts, packet.timeBase);
      }

      const keyFrame =
        (packet.flags & AV_PKT_FLAG_KEY) === AV_PKT_FLAG_KEY || packet.isKeyframe;

      // Process packet: extract codec description and convert format if needed
      const codecType = context.isAvcCodec ? 'avc' : context.isHevcCodec ? 'hevc' : 'other';
      const result = processEncodedPacket(
        packet.data,
        keyFrame,
        codecType,
        codecDescription,
        context.outputFormat
      );

      // Update codec description if newly extracted
      if (result.description && !codecDescription) {
        codecDescription = result.description;
      }

      const frame: EncodedFrame = {
        data: result.frameData,
        timestamp,
        keyFrame,
        description: codecDescription ?? undefined,
      };

      logger.debug(`Encoded packet: size=${packet.data.length}, key=${keyFrame}`);
      frames.push(frame);
    }
    packet.unref();
    packet = await encoder.receive();
  }

  return { frames, codecDescription };
}
