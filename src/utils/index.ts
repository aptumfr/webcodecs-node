/**
 * Utility exports
 */

// Buffer utilities
export {
  toUint8Array,
  copyToUint8Array,
  concatUint8Arrays,
  isReadableStream,
  readStreamToUint8Array,
} from './buffer.js';

// Validation utilities
export {
  validatePositiveInteger,
  validateNonNegativeInteger,
  validateFiniteNumber,
  validateRequired,
  validateNonEmptyString,
  validateConfigured,
  validateNotClosed,
} from './validation.js';

// Logger
export {
  Logger,
  createLogger,
  setDebugMode,
  isDebugMode,
  type LogLevel,
  type LogEntry,
} from './logger.js';

// Type guards
export {
  isImageDataLike,
  isCanvasLike,
  isVideoFrameLike,
  isCanvasImageSource,
  type ImageDataLike,
  type CanvasLike,
  type VideoFrameLike,
} from './type-guards.js';

// Codec helpers
export {
  parseAvcDecoderConfig,
  convertAvccToAnnexB,
  splitAnnexBNals,
  extractAvcParameterSetsFromAnnexB,
  buildAvcDecoderConfig,
  convertAnnexBToAvcc,
  type AvcConfig,
} from './avc.js';

export {
  parseHvccDecoderConfig,
  convertHvccToAnnexB,
  splitHevcAnnexBNals,
  extractHevcParameterSetsFromAnnexB,
  buildHvccDecoderConfig,
  convertAnnexBToHvcc,
  type HvccConfig,
} from './hevc.js';

export {
  parseAudioSpecificConfig,
  wrapAacFrameWithAdts,
  buildAudioSpecificConfig,
  stripAdtsHeader,
  type AacConfig,
} from './aac.js';

// EventTarget support
export {
  WebCodecsEventTarget,
  type EventListener,
  type EventListenerOptions,
} from './event-target.js';

// Codec caching utilities
export {
  getCodecBase,
  parseCodec,
  getVideoCodecName,
  getAudioCodecName,
  isVideoCodec,
  isAudioCodec,
  clearCodecCache,
  type ParsedCodec,
  type VideoCodecName,
  type AudioCodecName,
} from './codec-cache.js';

// Timeout utilities
export {
  withTimeout,
  createTimeoutWrapper,
  createTimeoutAbortController,
  DEFAULT_TIMEOUTS,
} from './timeout.js';

// Error utilities
export {
  createWebCodecsError,
  invalidStateError,
  notSupportedError,
  dataError,
  encodingError,
  abortError,
  quotaExceededError,
  timeoutError,
  wrapAsWebCodecsError,
  isWebCodecsError,
  type WebCodecsErrorName,
} from './errors.js';

// Hardware context pooling
export {
  HardwareContextPool,
  getHardwarePool,
  initHardwarePool,
  disposeHardwarePool,
  acquireHardwareContext,
  releaseHardwareContext,
  type HardwarePoolConfig,
} from './hardware-pool.js';

// Buffer pooling for efficient memory reuse
export {
  BufferPool,
  getBufferPool,
  initBufferPool,
  disposeBufferPool,
  acquireBuffer,
  releaseBuffer,
  type BufferPoolConfig,
  type BufferPoolStats,
} from './buffer-pool.js';
