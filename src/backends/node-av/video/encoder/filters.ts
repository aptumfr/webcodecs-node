/**
 * Filter chain utilities for video encoding
 *
 * Handles creation and management of FFmpeg filter chains
 * for format conversion and rescaling.
 */

import { FilterAPI, type HardwareContext } from 'node-av/api';

import { createLogger } from '../../../../utils/logger.js';
import { buildGpuFilterChain } from './gpu-filters.js';

const logger = createLogger('encoder-filters');

export interface FilterConfig {
  /** Target format name (e.g., 'nv12', 'yuv420p') */
  targetFormat: string;
  /** Input dimensions */
  inputWidth: number;
  inputHeight: number;
  /** Output dimensions */
  outputWidth: number;
  outputHeight: number;
  /** Whether rescaling is needed */
  needsRescaling: boolean;
  /** Whether format conversion is needed */
  needsFormatConversion: boolean;
}

/**
 * Build a CPU filter chain string for format conversion and/or rescaling
 */
export function buildCpuFilterChain(config: FilterConfig): string {
  const filterParts: string[] = [];

  if (config.needsRescaling) {
    // Use lanczos scaling for high quality
    filterParts.push(`scale=${config.outputWidth}:${config.outputHeight}:flags=lanczos`);
  }

  if (config.needsFormatConversion) {
    filterParts.push(`format=${config.targetFormat}`);
  }

  return filterParts.join(',');
}

/**
 * Create a filter chain for encoding
 *
 * Tries GPU-accelerated filter first if hardware context is available,
 * falls back to CPU filter chain otherwise.
 */
export function createEncoderFilter(
  config: FilterConfig,
  hardware: HardwareContext | null
): FilterAPI | null {
  // No filter needed if no conversion or rescaling
  if (!config.needsFormatConversion && !config.needsRescaling) {
    return null;
  }

  // Log rescaling if needed
  if (config.needsRescaling) {
    logger.debug(
      `Rescaling: ${config.inputWidth}x${config.inputHeight} → ${config.outputWidth}x${config.outputHeight}`
    );
  }

  // Try GPU-accelerated filter if hardware context is available
  if (hardware) {
    const hwType = hardware.deviceTypeName;
    const gpuFilter = buildGpuFilterChain(
      hwType,
      config.targetFormat,
      config.inputWidth,
      config.inputHeight,
      config.outputWidth,
      config.outputHeight
    );

    if (gpuFilter) {
      try {
        const filter = FilterAPI.create(gpuFilter, {
          hardware,
        } as any);
        logger.debug(`Created GPU filter chain (${hwType}): ${gpuFilter}`);
        return filter;
      } catch (err) {
        logger.debug(`GPU filter failed, falling back to CPU: ${(err as Error).message}`);
      }
    }
  }

  // Fallback: CPU filter chain via libswscale
  const filterChain = buildCpuFilterChain(config);
  const filter = FilterAPI.create(filterChain);
  logger.debug(`Created CPU filter chain: ${filterChain}`);
  return filter;
}

/**
 * Create a CPU fallback filter after GPU filter failure
 */
export function createCpuFallbackFilter(config: FilterConfig): FilterAPI {
  const filterChain = buildCpuFilterChain(config);
  logger.debug(`Created CPU fallback filter: ${filterChain}`);
  return FilterAPI.create(filterChain);
}
