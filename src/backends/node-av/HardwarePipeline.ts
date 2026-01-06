/**
 * HardwarePipeline - Intelligent filter chain selection for hardware video processing
 *
 * Automatically detects hardware capabilities and builds optimal filter chains
 * for format conversion, preferring GPU-side operations when possible.
 */

import { FilterAPI, HardwareContext } from 'node-av/api';

import { createLogger } from '../../utils/logger.js';
import { type HardwareType, HARDWARE_CAPABILITIES } from './hardware-pipeline/index.js';

// Re-export types from submodule
export type { HardwareType, HardwareFormatCapabilities } from './hardware-pipeline/index.js';

const logger = createLogger('HardwarePipeline');

/**
 * Cache for probed filter chains
 * Maps: hardwareType -> outputFormat -> working filter chain (or null if none work)
 */
const filterChainCache = new Map<string, Map<string, string | null>>();

/**
 * Test if a filter chain works by trying to create it
 * Note: This only tests creation, not actual processing. Some filters may create
 * successfully but fail during processing (e.g., vpp_qsv with missing MFX loader).
 */
function probeFilterChain(
  filterDescription: string,
  hardware: HardwareContext | null
): boolean {
  try {
    const filter = FilterAPI.create(filterDescription, {
      hardware: hardware ?? undefined,
    } as any);
    filter.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a filter chain as failed (discovered during actual processing)
 */
export function markFilterChainFailed(hwType: string, outputFormat: string, isHardwareFrame: boolean): void {
  const cacheKey = isHardwareFrame ? outputFormat : `sw_${outputFormat}`;
  let hwCache = filterChainCache.get(hwType);
  if (!hwCache) {
    hwCache = new Map();
    filterChainCache.set(hwType, hwCache);
  }
  // Mark current chain as failed by setting to null
  hwCache.set(cacheKey, null);
  // Also mark it in failed chains set
  failedFilterChains.add(`${hwType}:${cacheKey}`);
}

/**
 * Set of filter chains that failed during actual processing
 */
const failedFilterChains = new Set<string>();

/**
 * Check if a specific chain has been marked as failed
 */
function isChainFailed(hwType: string, outputFormat: string, isHardwareFrame: boolean): boolean {
  const cacheKey = isHardwareFrame ? outputFormat : `sw_${outputFormat}`;
  return failedFilterChains.has(`${hwType}:${cacheKey}`);
}

/**
 * Get cached filter chain or null if not cached
 */
function getCachedFilterChain(hwType: string, outputFormat: string): string | null | undefined {
  const hwCache = filterChainCache.get(hwType);
  if (!hwCache) return undefined;
  return hwCache.get(outputFormat);
}

/**
 * Cache a filter chain result
 */
function cacheFilterChain(hwType: string, outputFormat: string, chain: string | null): void {
  let hwCache = filterChainCache.get(hwType);
  if (!hwCache) {
    hwCache = new Map();
    filterChainCache.set(hwType, hwCache);
  }
  hwCache.set(outputFormat, chain);
}

/**
 * Build candidate filter chains in order of preference (best first)
 */
function buildCandidateChains(
  hwType: HardwareType,
  outputFormat: string,
  isHardwareFrame: boolean
): string[] {
  const candidates: string[] = [];
  const caps = HARDWARE_CAPABILITIES[hwType];

  if (!isHardwareFrame) {
    // Software frame - just format conversion
    candidates.push(`format=${outputFormat}`);
    return candidates;
  }

  // Hardware frame - try various strategies

  // Strategy 1: GPU-side conversion if supported (best - no CPU conversion)
  if (caps.scaleFilter && caps.gpuOutputFormats.includes(outputFormat)) {
    // Full GPU: scale on GPU to target format, then download
    candidates.push(`${caps.scaleFilter}=format=${outputFormat},hwdownload,format=${outputFormat}`);
  }

  // Strategy 2: GPU conversion to intermediate, then CPU conversion
  // Try bgra/nv12 as intermediates since they're widely supported
  if (caps.scaleFilter) {
    for (const intermediate of ['bgra', 'nv12']) {
      if (caps.gpuOutputFormats.includes(intermediate) && intermediate !== outputFormat) {
        candidates.push(
          `${caps.scaleFilter}=format=${intermediate},hwdownload,format=${intermediate},format=${outputFormat}`
        );
      }
    }
  }

  // Strategy 3: Simple hwdownload then CPU conversion (most compatible)
  candidates.push(`hwdownload,format=nv12,format=${outputFormat}`);

  // Strategy 4: hwdownload with auto format detection
  candidates.push(`hwdownload,format=${outputFormat}`);

  return candidates;
}

/**
 * Track which chain index we're on for each hw/format combo (for fallback iteration)
 */
const chainIndexMap = new Map<string, number>();

/**
 * Select the best filter chain for the given hardware and output format.
 * Uses probing to verify the chain works on this specific hardware/driver.
 * If a chain fails during actual processing, call getNextFilterChain() to try the next one.
 */
export function selectBestFilterChain(
  hardware: HardwareContext | null,
  outputFormat: string,
  isHardwareFrame: boolean
): string {
  const hwType: HardwareType = (hardware?.deviceTypeName as HardwareType) ?? 'software';
  const cacheKey = `${hwType}:${isHardwareFrame ? outputFormat : `sw_${outputFormat}`}`;

  // Build candidates in preference order
  const candidates = buildCandidateChains(hwType, outputFormat, isHardwareFrame);

  // Get current index (which chain we're trying)
  const currentIndex = chainIndexMap.get(cacheKey) ?? 0;

  // If we've exhausted all candidates, use the most compatible fallback
  if (currentIndex >= candidates.length) {
    const fallback = `hwdownload,format=nv12,format=${outputFormat}`;
    logger.debug(`All chains exhausted for ${hwType}/${outputFormat}, using final fallback`);
    return fallback;
  }

  const chain = candidates[currentIndex];
  logger.debug(`Trying chain ${currentIndex + 1}/${candidates.length} for ${hwType}/${outputFormat}: ${chain}`);

  return chain;
}

/**
 * Move to the next filter chain after the current one failed.
 * Returns the next chain to try, or null if all chains have been exhausted.
 */
export function getNextFilterChain(
  hardware: HardwareContext | null,
  outputFormat: string,
  isHardwareFrame: boolean
): string | null {
  const hwType: HardwareType = (hardware?.deviceTypeName as HardwareType) ?? 'software';
  const cacheKey = `${hwType}:${isHardwareFrame ? outputFormat : `sw_${outputFormat}`}`;

  // Increment the chain index
  const currentIndex = (chainIndexMap.get(cacheKey) ?? 0) + 1;
  chainIndexMap.set(cacheKey, currentIndex);

  // Build candidates
  const candidates = buildCandidateChains(hwType, outputFormat, isHardwareFrame);

  if (currentIndex >= candidates.length) {
    logger.debug(`All ${candidates.length} chains failed for ${hwType}/${outputFormat}`);
    return null;
  }

  const chain = candidates[currentIndex];
  logger.debug(`Falling back to chain ${currentIndex + 1}/${candidates.length}: ${chain}`);

  return chain;
}

/**
 * Get human-readable description of the selected pipeline
 */
export function describePipeline(filterChain: string, hwType: string): string {
  const parts: string[] = [];

  if (filterChain.includes('scale_cuda')) {
    parts.push('CUDA GPU scaling');
  } else if (filterChain.includes('scale_vaapi')) {
    parts.push('VAAPI GPU scaling');
  } else if (filterChain.includes('vpp_qsv')) {
    parts.push('QSV GPU processing');
  } else if (filterChain.includes('scale_vt')) {
    parts.push('VideoToolbox GPU scaling');
  }

  if (filterChain.includes('hwdownload')) {
    parts.push('GPU→CPU transfer');
  }

  const formatMatches = filterChain.match(/format=(\w+)/g);
  if (formatMatches && formatMatches.length > 0) {
    const lastFormat = formatMatches[formatMatches.length - 1].replace('format=', '');
    parts.push(`output: ${lastFormat}`);
  }

  return parts.join(' → ') || filterChain;
}

/**
 * Clear the filter chain cache (useful for testing or after hardware changes)
 */
export function clearPipelineCache(): void {
  filterChainCache.clear();
}

/**
 * Get current cache status for debugging
 */
export function getPipelineCacheStatus(): Record<string, Record<string, string | null>> {
  const result: Record<string, Record<string, string | null>> = {};
  for (const [hwType, formats] of filterChainCache) {
    result[hwType] = {};
    for (const [format, chain] of formats) {
      result[hwType][format] = chain;
    }
  }
  return result;
}
