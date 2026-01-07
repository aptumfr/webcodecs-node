/**
 * Audio encoder helper utilities
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
