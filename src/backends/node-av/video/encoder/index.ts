/**
 * Video encoder helper utilities
 *
 * Organized into focused modules:
 * - pixel-format: Input pixel format mapping
 * - pixel-format-config: Encoder pixel format configuration
 * - software-encoders: Software encoder selection
 * - hardware-constraints: Hardware minimum resolution
 * - gpu-filters: GPU filter chain building
 * - filters: Filter chain creation and management
 * - options: Encoder options building
 * - codec-description: AVCC/HVCC extraction
 * - timestamp: PTS conversion utilities
 * - setup: Encoder codec selection
 * - drain: Packet draining utilities
 */

export { pixelFormatName, mapPixelFormat } from './pixel-format.js';
export { getSoftwareEncoder } from './software-encoders.js';
export { getHardwareMinResolution } from './hardware-constraints.js';
export { buildGpuFilterChain } from './gpu-filters.js';
export {
  buildEncoderOptions,
  configureVpxOptions,
  configureSvtAv1Options,
  configureX26xOptions,
  type EncoderOptions,
} from './options.js';
export {
  processEncodedPacket,
  processAvcPacket,
  processHevcPacket,
  type CodecDescriptionResult,
} from './codec-description.js';
export {
  microsecondsToPts,
  ptsToMicroseconds,
  getCodecTimeBase,
} from './timestamp.js';
export {
  selectEncoderCodec,
  fallbackToSoftware,
  type EncoderSelection,
  type EncoderCodec,
} from './setup.js';
export {
  configureEncoderPixelFormat,
  hasAlphaChannel,
  is10BitFormat,
  codecSupportsAlpha,
  codecSupports10Bit,
  type PixelFormatConfig,
} from './pixel-format-config.js';
export {
  createEncoderFilter,
  createCpuFallbackFilter,
  buildCpuFilterChain,
  type FilterConfig,
} from './filters.js';
export {
  drainEncoderPackets,
  type DrainContext,
  type DrainResult,
} from './drain.js';
