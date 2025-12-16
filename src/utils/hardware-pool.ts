/**
 * Hardware Context Pool - Reuses GPU hardware contexts across encoders/decoders
 *
 * Creating hardware contexts (VAAPI, CUDA, QSV, etc.) has overhead.
 * This pool maintains a set of reusable contexts to improve performance
 * when encoding/decoding multiple streams or files sequentially.
 */

import { HardwareContext } from 'node-av/api';
import { createLogger } from './logger.js';

const logger = createLogger('HardwarePool');

/**
 * Pool entry with usage tracking
 */
interface PoolEntry {
  context: HardwareContext;
  inUse: boolean;
  lastUsed: number;
  useCount: number;
}

/**
 * Configuration for the hardware context pool
 */
export interface HardwarePoolConfig {
  /** Maximum number of contexts to keep in the pool per device type */
  maxContextsPerType?: number;
  /** Time in ms after which unused contexts are disposed (default: 60000ms = 1 minute) */
  idleTimeoutMs?: number;
  /** Whether to automatically initialize contexts on first acquire (default: true) */
  lazyInit?: boolean;
}

const DEFAULT_CONFIG: Required<HardwarePoolConfig> = {
  maxContextsPerType: 2,
  idleTimeoutMs: 60_000,
  lazyInit: true,
};

/**
 * Pool for reusing hardware contexts
 */
class HardwareContextPool {
  private pools: Map<string, PoolEntry[]> = new Map();
  private config: Required<HardwarePoolConfig>;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(config: HardwarePoolConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
  }

  /**
   * Acquire a hardware context from the pool
   * Creates a new one if none available
   *
   * @param preferredType - Preferred device type (vaapi, cuda, qsv, videotoolbox)
   * @returns Hardware context or null if none available
   */
  acquire(preferredType?: string): HardwareContext | null {
    if (this.disposed) {
      return null;
    }

    // Try to get from pool first
    if (preferredType) {
      const pooled = this.acquireFromPool(preferredType);
      if (pooled) {
        logger.debug(`Reusing ${preferredType} context from pool`);
        return pooled;
      }
    }

    // Try auto-detection
    const pooled = this.acquireAnyAvailable();
    if (pooled) {
      return pooled;
    }

    // Create new context
    try {
      const context = HardwareContext.auto();
      if (context) {
        const deviceType = context.deviceTypeName || 'unknown';
        logger.info(`Created new hardware context: ${deviceType}`);
        this.trackContext(context, deviceType);
        return context;
      }
    } catch (err) {
      logger.debug(`Failed to create hardware context: ${(err as Error).message}`);
    }

    return null;
  }

  /**
   * Release a hardware context back to the pool
   * The context will be reused by future acquire() calls
   *
   * @param context - The hardware context to release
   */
  release(context: HardwareContext | null): void {
    if (!context || this.disposed) {
      return;
    }

    const deviceType = context.deviceTypeName || 'unknown';
    const pool = this.pools.get(deviceType);

    if (!pool) {
      // Context wasn't tracked, dispose it
      this.disposeContext(context);
      return;
    }

    const entry = pool.find(e => e.context === context);
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = Date.now();
      logger.debug(`Released ${deviceType} context back to pool (uses: ${entry.useCount})`);
    } else {
      // Context not in pool but matches type - add if pool not full
      if (pool.length < this.config.maxContextsPerType) {
        pool.push({
          context,
          inUse: false,
          lastUsed: Date.now(),
          useCount: 1,
        });
        logger.debug(`Added ${deviceType} context to pool`);
      } else {
        this.disposeContext(context);
      }
    }
  }

  /**
   * Get pool statistics
   */
  stats(): { deviceType: string; total: number; inUse: number; idle: number }[] {
    const result: { deviceType: string; total: number; inUse: number; idle: number }[] = [];

    for (const [deviceType, pool] of this.pools) {
      const inUse = pool.filter(e => e.inUse).length;
      result.push({
        deviceType,
        total: pool.length,
        inUse,
        idle: pool.length - inUse,
      });
    }

    return result;
  }

  /**
   * Dispose all contexts and stop the pool
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const [deviceType, pool] of this.pools) {
      for (const entry of pool) {
        this.disposeContext(entry.context);
      }
      logger.debug(`Disposed ${pool.length} ${deviceType} contexts`);
    }

    this.pools.clear();
    logger.info('Hardware context pool disposed');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────────

  private acquireFromPool(deviceType: string): HardwareContext | null {
    const pool = this.pools.get(deviceType);
    if (!pool) return null;

    const available = pool.find(e => !e.inUse);
    if (available) {
      available.inUse = true;
      available.useCount++;
      return available.context;
    }

    return null;
  }

  private acquireAnyAvailable(): HardwareContext | null {
    for (const [deviceType, pool] of this.pools) {
      const available = pool.find(e => !e.inUse);
      if (available) {
        available.inUse = true;
        available.useCount++;
        logger.debug(`Reusing ${deviceType} context from pool`);
        return available.context;
      }
    }
    return null;
  }

  private trackContext(context: HardwareContext, deviceType: string): void {
    let pool = this.pools.get(deviceType);
    if (!pool) {
      pool = [];
      this.pools.set(deviceType, pool);
    }

    pool.push({
      context,
      inUse: true,
      lastUsed: Date.now(),
      useCount: 1,
    });
  }

  private disposeContext(context: HardwareContext): void {
    try {
      context.dispose();
    } catch (err) {
      logger.debug(`Error disposing context: ${(err as Error).message}`);
    }
  }

  private startCleanupTimer(): void {
    // Run cleanup every 10 seconds
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleContexts();
    }, 10_000);

    // Don't prevent process from exiting
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private cleanupIdleContexts(): void {
    const now = Date.now();

    for (const [deviceType, pool] of this.pools) {
      // Keep at least one context per type, remove extras that are idle
      const keepCount = 1;
      let removed = 0;

      for (let i = pool.length - 1; i >= keepCount; i--) {
        const entry = pool[i];
        if (!entry.inUse && (now - entry.lastUsed) > this.config.idleTimeoutMs) {
          pool.splice(i, 1);
          this.disposeContext(entry.context);
          removed++;
        }
      }

      if (removed > 0) {
        logger.debug(`Cleaned up ${removed} idle ${deviceType} contexts`);
      }
    }
  }
}

// Singleton instance
let globalPool: HardwareContextPool | null = null;

/**
 * Get the global hardware context pool
 * Creates one on first access with default configuration
 */
export function getHardwarePool(): HardwareContextPool {
  if (!globalPool) {
    globalPool = new HardwareContextPool();
  }
  return globalPool;
}

/**
 * Initialize the global pool with custom configuration
 * Should be called before first use if custom config is needed
 */
export function initHardwarePool(config: HardwarePoolConfig): HardwareContextPool {
  if (globalPool) {
    globalPool.dispose();
  }
  globalPool = new HardwareContextPool(config);
  return globalPool;
}

/**
 * Dispose the global pool and release all contexts
 * Call this when shutting down the application
 */
export function disposeHardwarePool(): void {
  if (globalPool) {
    globalPool.dispose();
    globalPool = null;
  }
}

/**
 * Convenience function to acquire a hardware context from the global pool
 */
export function acquireHardwareContext(preferredType?: string): HardwareContext | null {
  return getHardwarePool().acquire(preferredType);
}

/**
 * Convenience function to release a hardware context back to the global pool
 */
export function releaseHardwareContext(context: HardwareContext | null): void {
  getHardwarePool().release(context);
}

export { HardwareContextPool };
