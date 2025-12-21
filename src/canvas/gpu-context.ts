/**
 * GPU Context Management for skia-canvas
 *
 * Provides GPU detection and canvas factory with auto-detection
 * for Metal (macOS), Vulkan (Linux/Windows), and D3D (Windows).
 */

import { Canvas } from 'skia-canvas';
import { createLogger } from '../utils/logger.js';
import type { GpuEngineInfo, CanvasConfig } from './types.js';

const logger = createLogger('GpuContext');

// Cached GPU availability result
let gpuAvailability: GpuEngineInfo | null = null;
let gpuCheckPerformed = false;

/**
 * Detect available GPU acceleration
 * Uses a minimal probe canvas to check GPU availability.
 * Results are cached for performance.
 */
export function detectGpuAcceleration(): GpuEngineInfo {
  if (gpuCheckPerformed && gpuAvailability) {
    return gpuAvailability;
  }

  try {
    // Create minimal probe canvas
    const probe = new Canvas(1, 1) as any;
    probe.gpu = true; // Request GPU

    // Access engine info to trigger GPU initialization
    const engine = probe.engine;

    gpuAvailability = {
      renderer: engine.renderer === 'GPU' ? 'GPU' : 'CPU',
      api: engine.api as GpuEngineInfo['api'],
      device: engine.device,
      driver: engine.driver,
      threads: engine.threads,
      error: engine.error,
    };

    gpuCheckPerformed = true;

    logger.info(
      `GPU Detection: ${engine.renderer}${engine.api ? ` (${engine.api})` : ''}`
    );
    if (engine.error) {
      logger.warn(`GPU fallback reason: ${engine.error}`);
    }

    return gpuAvailability;
  } catch (error) {
    gpuAvailability = {
      renderer: 'CPU',
      error: error instanceof Error ? error.message : String(error),
    };
    gpuCheckPerformed = true;
    logger.warn('GPU detection failed, using CPU rendering');
    return gpuAvailability;
  }
}

/**
 * Check if GPU acceleration is available
 */
export function isGpuAvailable(): boolean {
  const info = detectGpuAcceleration();
  return info.renderer === 'GPU';
}

/**
 * Get the GPU API name (Metal, Vulkan, D3D, or null for CPU)
 */
export function getGpuApi(): 'Metal' | 'Vulkan' | 'D3D' | null {
  const info = detectGpuAcceleration();
  return info.api ?? null;
}

/**
 * Create a canvas with optimal GPU settings
 *
 * @param config - Canvas configuration
 * @returns A new skia-canvas Canvas instance
 */
export function createCanvas(config: CanvasConfig): Canvas {
  const canvas = new Canvas(config.width, config.height) as any;

  // Set GPU preference (auto-detect if not specified)
  if (config.gpu !== undefined) {
    canvas.gpu = config.gpu;
  } else {
    // Auto-detect: use GPU if available
    canvas.gpu = isGpuAvailable();
  }

  return canvas as Canvas;
}

/**
 * Ensure dimensions are even (required for YUV420 compatibility)
 *
 * Most video codecs (H.264, HEVC, VP9) require even dimensions
 * for chroma subsampling. This utility rounds up odd dimensions.
 *
 * @param width - Original width
 * @param height - Original height
 * @returns Dimensions rounded up to even values
 */
export function ensureEvenDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  return {
    width: width % 2 === 0 ? width : width + 1,
    height: height % 2 === 0 ? height : height + 1,
  };
}

/**
 * Validate that dimensions are even (throws if not)
 *
 * Many hardware encoders (NVENC, QuickSync, VideoToolbox) will fail
 * silently or crash if dimensions are not divisible by 2. Use this
 * for strict validation in encoder configuration.
 *
 * @param width - Width to validate
 * @param height - Height to validate
 * @throws Error if width or height is odd
 */
export function validateEvenDimensions(width: number, height: number): void {
  const errors: string[] = [];

  if (width % 2 !== 0) {
    errors.push(`width (${width}) must be even for video encoding`);
  }
  if (height % 2 !== 0) {
    errors.push(`height (${height}) must be even for video encoding`);
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid dimensions: ${errors.join(', ')}. ` +
      `Hardware encoders require even dimensions for YUV420 chroma subsampling. ` +
      `Use ensureEvenDimensions() to auto-fix, or adjust your source dimensions.`
    );
  }
}

/**
 * Reset the GPU detection cache
 * Useful for testing or when GPU availability may have changed
 */
export function resetGpuCache(): void {
  gpuAvailability = null;
  gpuCheckPerformed = false;
}
