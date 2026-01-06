/**
 * Queue size calculation utilities for VideoDecoder
 */

/**
 * Calculate optimal queue size based on resolution to limit memory usage.
 * Target: ~250-500MB max memory for queued frames (RGBA format).
 */
export function calculateMaxQueueSize(width: number, height: number): number {
  const pixels = width * height;
  const rgbaFrameBytes = pixels * 4;

  // Target max memory: ~300MB for queue
  const targetMemory = 300 * 1024 * 1024;
  const calculated = Math.floor(targetMemory / rgbaFrameBytes);

  // Clamp between 4 (minimum for smooth operation) and 100 (legacy max)
  return Math.max(4, Math.min(100, calculated));
}
