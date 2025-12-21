/**
 * Canvas Module - skia-canvas integration for WebCodecs
 *
 * Provides GPU-accelerated canvas operations using skia-canvas:
 * - Metal acceleration on macOS
 * - Vulkan acceleration on Linux/Windows
 * - D3D acceleration on Windows
 * - Automatic CPU fallback
 *
 * Best practices implemented:
 * - Memory lifecycle with explicit frame closing
 * - Canvas state reset before each frame
 * - RGBA raw buffer export (never PNG)
 * - Even dimensions for YUV420 compatibility
 * - Backpressure with configurable queue size
 */

// Re-export skia-canvas for direct use
export { Canvas, loadImage, FontLibrary } from 'skia-canvas';

// GPU context management
export {
  detectGpuAcceleration,
  isGpuAvailable,
  getGpuApi,
  createCanvas,
  ensureEvenDimensions,
  validateEvenDimensions,
  resetGpuCache,
} from './gpu-context.js';

// Canvas utilities
export {
  createPixelBuffer,
  createPixelBufferWithColor,
  getRawPixels,
  getRawPixelsAsync,
  resetCanvas,
  pixelsToImageData,
  drawPixelsToCanvas,
  bufferToUint8Array,
  resizePixels,
} from './canvas-utils.js';

// FrameLoop helper
export { FrameLoop, createFrameLoop } from './frame-loop.js';

// Types
export type {
  GpuEngineInfo,
  CanvasConfig,
  FrameTiming,
  FrameLoopConfig,
  FrameLoopState,
  RawBufferOptions,
  FrameCallback,
  SkiaCanvas,
  SkiaEngineInfo,
} from './types.js';
