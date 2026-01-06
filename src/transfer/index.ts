/**
 * Transfer module
 *
 * Provides utilities for ArrayBuffer transfer semantics in WebCodecs objects.
 * Handles buffer detachment, transfer list validation, and data copying.
 */

// Detachment utilities
export {
  isDetached,
  isDetachedStrict,
  detachBuffer,
  copyBufferData,
} from './detach.js';

// Validation utilities
export {
  validateTransferList,
  validateNotDetached,
  validateDescriptionNotDetached,
  isInTransferList,
  detachTransferredBuffers,
} from './validate.js';
