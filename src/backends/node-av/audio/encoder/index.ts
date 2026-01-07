/**
 * Audio encoder helper utilities
 *
 * Organized into focused modules:
 * - constants: Shared constants (OPUS_SAMPLE_RATE)
 * - codec-mapping: Codec name/codec mapping
 * - channel-layout: Channel layout utilities
 * - sample-format-convert: Sample format conversion utilities
 * - options: Encoder options building
 * - codec-description: Codec description extraction
 * - drain: Packet draining utilities
 */

export { OPUS_SAMPLE_RATE } from './constants.js';
export { getEncoderName, getEncoderCodec } from './codec-mapping.js';
export { getChannelLayout } from './channel-layout.js';
export {
  convertToPlanar,
  convertToS16Interleaved,
  convertToS32Interleaved,
  convertToS16Planar,
  convertToU8Interleaved,
  convertFromPlanarToInterleaved,
  convertFromS16ToF32Interleaved,
  convertFromS16PlanarToF32Interleaved,
  convertFromS32ToF32Interleaved,
} from './sample-format-convert.js';
export {
  buildAudioEncoderOptions,
  getCodecSampleFormat,
  configureOpusOptions,
  configureAacOptions,
  type AudioEncoderOptions,
} from './options.js';
export {
  extractCodecDescription,
  generateOpusHead,
  buildFlacDescription,
  type CodecDescriptionContext,
} from './codec-description.js';
export {
  drainAudioPackets,
  type AudioDrainContext,
  type AudioDrainResult,
} from './drain.js';
