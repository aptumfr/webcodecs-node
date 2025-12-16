/**
 * Timeout utilities for async operations
 */

import { DOMException } from '../types/index.js';

/**
 * Default timeout values in milliseconds
 */
export const DEFAULT_TIMEOUTS = {
  /** Timeout for encoder/decoder configuration */
  configure: 10_000,
  /** Timeout for flush operations */
  flush: 30_000,
  /** Timeout for muxer/demuxer open operations */
  open: 15_000,
  /** Timeout for close operations */
  close: 10_000,
} as const;

/**
 * Wrap a promise with a timeout
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of the operation for error messages
 * @returns The result of the promise
 * @throws DOMException with TimeoutError if timeout is exceeded
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string = 'Operation'
): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new DOMException(
        `${operationName} timed out after ${timeoutMs}ms`,
        'TimeoutError'
      ));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    return result;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Create a timeout-wrapped version of an async function
 *
 * @param fn - The async function to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of the operation for error messages
 * @returns A wrapped function that will timeout
 */
export function createTimeoutWrapper<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  timeoutMs: number,
  operationName: string
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return withTimeout(fn(...args), timeoutMs, operationName);
  }) as T;
}

/**
 * Abort controller with timeout
 * Useful for operations that support AbortSignal
 */
export function createTimeoutAbortController(timeoutMs: number): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Operation timed out', 'TimeoutError'));
  }, timeoutMs);

  return {
    controller,
    cleanup: () => clearTimeout(timeoutId),
  };
}
