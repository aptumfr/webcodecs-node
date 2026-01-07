/**
 * Audio packet drain utilities
 *
 * Handles draining encoded packets from the audio encoder
 * and converting them to EncodedFrame output format.
 */

import type { Encoder } from 'node-av/api';
import { AV_PKT_FLAG_KEY } from 'node-av/constants';

import type { EncodedFrame } from '../../../types.js';
import { createLogger } from '../../../../utils/logger.js';

const logger = createLogger('audio-encoder-drain');

export interface AudioDrainContext {
  /** Codec description (AAC AudioSpecificConfig, OpusHead, etc.) */
  codecDescription: Buffer | null;
  /** Encoder sample rate for duration calculation */
  encoderSampleRate: number;
  /** Fallback frame index for timestamp */
  frameIndex: number;
  /** Whether this is the first frame (for attaching description) */
  firstFrame: boolean;
}

export interface AudioDrainResult {
  /** Encoded frames extracted from packets */
  frames: EncodedFrame[];
  /** Whether first frame was emitted */
  firstFrameEmitted: boolean;
}

/**
 * Drain all available packets from the audio encoder
 *
 * Converts packets to EncodedFrame format, attaching codec description
 * to the first frame.
 */
export async function drainAudioPackets(
  encoder: Encoder,
  context: AudioDrainContext
): Promise<AudioDrainResult> {
  const frames: EncodedFrame[] = [];
  let firstFrameEmitted = !context.firstFrame;

  let packet = await encoder.receive();
  while (packet) {
    if (packet.data) {
      const timestamp = packet.pts !== undefined ? Number(packet.pts) : context.frameIndex;
      const keyFrame = (packet.flags & AV_PKT_FLAG_KEY) === AV_PKT_FLAG_KEY || (packet as any).isKeyframe;

      // Get actual duration from packet (in timebase units), convert to samples
      let durationSamples: number | undefined;
      if (packet.duration !== undefined && packet.duration > 0n) {
        const tb = packet.timeBase;
        if (tb && tb.den > 0) {
          // duration_samples = duration * (tb.num / tb.den) * sampleRate
          durationSamples = Number(
            (packet.duration * BigInt(tb.num) * BigInt(context.encoderSampleRate)) / BigInt(tb.den)
          );
        }
      }

      const frameData: EncodedFrame = {
        data: Buffer.from(packet.data),
        timestamp,
        keyFrame,
        durationSamples,
      };

      // Include codec description on the first frame
      if (!firstFrameEmitted && context.codecDescription) {
        frameData.description = context.codecDescription;
        firstFrameEmitted = true;
      }

      frames.push(frameData);
    }
    packet.unref();
    packet = await encoder.receive();
  }

  return { frames, firstFrameEmitted };
}
