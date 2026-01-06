/**
 * VideoFrame module
 *
 * Re-exports from the main VideoFrame.ts for backward compatibility.
 * The VideoFrame class delegates to these extracted helper modules.
 */

// Main VideoFrame class (re-export from parent for backward compatibility)
export { VideoFrame } from '../VideoFrame.js';

// Validation utilities
export {
  VALID_PIXEL_FORMATS,
  validateFinitePositive,
  validateDuration,
  validateRotation,
  validateSubsamplingAlignment,
  validateVisibleRect,
} from './validation.js';

// Transfer utilities
export {
  isDetached,
  detachArrayBuffers,
  validateTransferList,
} from './transfer.js';

// Orientation utilities
export {
  composeOrientations,
  computeDefaultDisplayDimensions,
} from './orientation.js';

// Layout utilities
export { getPlaneLayoutForSize } from './layout.js';

// Metadata types
export type { VideoFrameMetadata } from './metadata.js';
