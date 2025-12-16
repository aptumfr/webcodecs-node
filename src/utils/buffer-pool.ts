/**
 * Buffer Pool - Reuses typed array buffers to reduce allocation overhead
 *
 * Frequently allocating large buffers (e.g., 1080p frame = ~8MB) can cause
 * GC pressure. This pool maintains reusable buffers organized by size buckets.
 *
 * Usage:
 * - For temporary buffers in format conversions, encoding, decoding
 * - NOT for long-lived VideoFrame/AudioData data (those follow WebCodecs lifecycle)
 */

import { createLogger } from './logger.js';

const logger = createLogger('BufferPool');

/**
 * Pool configuration
 */
export interface BufferPoolConfig {
  /** Size buckets for buffer allocation (defaults cover common video resolutions) */
  sizeBuckets?: number[];
  /** Maximum number of buffers to keep per bucket */
  maxBuffersPerBucket?: number;
  /** Time in ms after which unused buffers are released (default: 30000ms) */
  idleTimeoutMs?: number;
  /** Whether to track statistics (default: false in production) */
  trackStats?: boolean;
}

/**
 * Default size buckets optimized for video frames:
 * - Small: 720p I420 (~1.4MB), 720p RGBA (~3.7MB)
 * - Medium: 1080p I420 (~3.1MB), 1080p RGBA (~8.3MB)
 * - Large: 4K I420 (~12.4MB), 4K RGBA (~33MB)
 */
const DEFAULT_SIZE_BUCKETS = [
  512 * 1024,        // 512KB - small audio/thumbnails
  1024 * 1024,       // 1MB
  2 * 1024 * 1024,   // 2MB - 720p I420
  4 * 1024 * 1024,   // 4MB - 720p RGBA / 1080p I420
  8 * 1024 * 1024,   // 8MB - 1080p RGBA
  16 * 1024 * 1024,  // 16MB - 4K I420
  32 * 1024 * 1024,  // 32MB - 4K RGBA
  64 * 1024 * 1024,  // 64MB - 8K I420
];

const DEFAULT_CONFIG: Required<BufferPoolConfig> = {
  sizeBuckets: DEFAULT_SIZE_BUCKETS,
  maxBuffersPerBucket: 4,
  idleTimeoutMs: 30_000,
  trackStats: false,
};

/**
 * Pool entry with usage tracking
 */
interface PoolEntry {
  buffer: Uint8Array;
  lastUsed: number;
}

/**
 * Statistics for monitoring pool efficiency
 */
export interface BufferPoolStats {
  hits: number;
  misses: number;
  allocations: number;
  returns: number;
  discards: number;
  totalPooled: number;
  totalPooledBytes: number;
}

/**
 * Buffer pool for efficient buffer reuse
 */
class BufferPool {
  private buckets: Map<number, PoolEntry[]> = new Map();
  private config: Required<BufferPoolConfig>;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private stats: BufferPoolStats = {
    hits: 0,
    misses: 0,
    allocations: 0,
    returns: 0,
    discards: 0,
    totalPooled: 0,
    totalPooledBytes: 0,
  };

  constructor(config: BufferPoolConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize buckets
    for (const size of this.config.sizeBuckets) {
      this.buckets.set(size, []);
    }

    this.startCleanupTimer();
  }

  /**
   * Acquire a buffer of at least the specified size
   * Returns a buffer from the pool if available, or allocates a new one
   *
   * @param size - Minimum required buffer size in bytes
   * @returns Uint8Array of at least the requested size
   */
  acquire(size: number): Uint8Array {
    if (this.disposed) {
      return new Uint8Array(size);
    }

    const bucketSize = this.findBucketSize(size);

    if (bucketSize === null) {
      // Size too large for buckets, allocate directly
      if (this.config.trackStats) {
        this.stats.allocations++;
        this.stats.misses++;
      }
      return new Uint8Array(size);
    }

    const bucket = this.buckets.get(bucketSize)!;

    if (bucket.length > 0) {
      const entry = bucket.pop()!;
      if (this.config.trackStats) {
        this.stats.hits++;
        this.stats.totalPooled--;
        this.stats.totalPooledBytes -= bucketSize;
      }
      // Return a view of the buffer with exact requested size
      return entry.buffer.subarray(0, size);
    }

    // No pooled buffer available, allocate new one at bucket size
    if (this.config.trackStats) {
      this.stats.allocations++;
      this.stats.misses++;
    }

    const buffer = new Uint8Array(bucketSize);
    return buffer.subarray(0, size);
  }

  /**
   * Return a buffer to the pool for reuse
   *
   * @param buffer - The buffer to return (must be the original buffer, not a subarray)
   */
  release(buffer: Uint8Array | null): void {
    if (!buffer || this.disposed) {
      return;
    }

    // Get the underlying buffer's full length
    const fullBuffer = buffer.byteLength === buffer.buffer.byteLength
      ? buffer
      : new Uint8Array(buffer.buffer, buffer.byteOffset);

    const bucketSize = this.findExactBucketSize(fullBuffer.byteLength);

    if (bucketSize === null) {
      // Not a poolable size, let GC handle it
      if (this.config.trackStats) {
        this.stats.discards++;
      }
      return;
    }

    const bucket = this.buckets.get(bucketSize)!;

    if (bucket.length >= this.config.maxBuffersPerBucket) {
      // Bucket full, let GC handle this buffer
      if (this.config.trackStats) {
        this.stats.discards++;
      }
      return;
    }

    // Add to pool
    bucket.push({
      buffer: fullBuffer,
      lastUsed: Date.now(),
    });

    if (this.config.trackStats) {
      this.stats.returns++;
      this.stats.totalPooled++;
      this.stats.totalPooledBytes += bucketSize;
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): BufferPoolStats {
    return { ...this.stats };
  }

  /**
   * Clear all pooled buffers
   */
  clear(): void {
    for (const bucket of this.buckets.values()) {
      bucket.length = 0;
    }
    this.stats.totalPooled = 0;
    this.stats.totalPooledBytes = 0;
    logger.debug('Buffer pool cleared');
  }

  /**
   * Dispose the pool and release all buffers
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.clear();
    logger.info('Buffer pool disposed');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find the smallest bucket that can fit the requested size
   */
  private findBucketSize(size: number): number | null {
    for (const bucketSize of this.config.sizeBuckets) {
      if (bucketSize >= size) {
        return bucketSize;
      }
    }
    return null;
  }

  /**
   * Find exact bucket size match
   */
  private findExactBucketSize(size: number): number | null {
    if (this.buckets.has(size)) {
      return size;
    }
    return null;
  }

  private startCleanupTimer(): void {
    // Run cleanup every 10 seconds
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleBuffers();
    }, 10_000);

    // Don't prevent process from exiting
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private cleanupIdleBuffers(): void {
    const now = Date.now();
    let removed = 0;
    let bytesRemoved = 0;

    for (const [size, bucket] of this.buckets) {
      // Keep at least one buffer per bucket for quick reuse
      const keepCount = 1;

      for (let i = bucket.length - 1; i >= keepCount; i--) {
        const entry = bucket[i];
        if ((now - entry.lastUsed) > this.config.idleTimeoutMs) {
          bucket.splice(i, 1);
          removed++;
          bytesRemoved += size;
        }
      }
    }

    if (removed > 0) {
      if (this.config.trackStats) {
        this.stats.totalPooled -= removed;
        this.stats.totalPooledBytes -= bytesRemoved;
      }
      logger.debug(`Cleaned up ${removed} idle buffers (${(bytesRemoved / 1024 / 1024).toFixed(1)}MB)`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global pool singleton
// ─────────────────────────────────────────────────────────────────────────────

let globalPool: BufferPool | null = null;

/**
 * Get the global buffer pool
 * Creates one on first access with default configuration
 */
export function getBufferPool(): BufferPool {
  if (!globalPool) {
    globalPool = new BufferPool();
  }
  return globalPool;
}

/**
 * Initialize the global pool with custom configuration
 * Should be called before first use if custom config is needed
 */
export function initBufferPool(config: BufferPoolConfig): BufferPool {
  if (globalPool) {
    globalPool.dispose();
  }
  globalPool = new BufferPool(config);
  return globalPool;
}

/**
 * Dispose the global pool
 * Call this when shutting down the application
 */
export function disposeBufferPool(): void {
  if (globalPool) {
    globalPool.dispose();
    globalPool = null;
  }
}

/**
 * Acquire a buffer from the global pool
 * @param size - Minimum required buffer size in bytes
 */
export function acquireBuffer(size: number): Uint8Array {
  return getBufferPool().acquire(size);
}

/**
 * Release a buffer back to the global pool
 * @param buffer - The buffer to return
 */
export function releaseBuffer(buffer: Uint8Array | null): void {
  getBufferPool().release(buffer);
}

export { BufferPool };
