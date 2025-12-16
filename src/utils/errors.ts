/**
 * Standardized error utilities for WebCodecs compliance
 *
 * The WebCodecs spec uses specific DOMException error names:
 * - InvalidStateError: operation on wrong state
 * - NotSupportedError: unsupported codec/config
 * - DataError: malformed/corrupt data
 * - EncodingError: codec processing failure
 * - AbortError: operation was aborted
 * - TypeError: invalid parameters (thrown, not via callback)
 * - QuotaExceededError: queue full
 * - TimeoutError: operation timed out
 */

import { DOMException } from '../types/index.js';

/**
 * Standard WebCodecs error types
 */
export type WebCodecsErrorName =
  | 'InvalidStateError'
  | 'NotSupportedError'
  | 'DataError'
  | 'EncodingError'
  | 'AbortError'
  | 'QuotaExceededError'
  | 'TimeoutError';

/**
 * Create a WebCodecs-compliant error
 */
export function createWebCodecsError(
  message: string,
  name: WebCodecsErrorName
): DOMException {
  return new DOMException(message, name);
}

/**
 * Create an InvalidStateError (e.g., encoder not configured)
 */
export function invalidStateError(message: string): DOMException {
  return new DOMException(message, 'InvalidStateError');
}

/**
 * Create a NotSupportedError (e.g., unsupported codec)
 */
export function notSupportedError(message: string): DOMException {
  return new DOMException(message, 'NotSupportedError');
}

/**
 * Create a DataError (e.g., corrupt input data)
 */
export function dataError(message: string): DOMException {
  return new DOMException(message, 'DataError');
}

/**
 * Create an EncodingError (e.g., codec processing failed)
 */
export function encodingError(message: string): DOMException {
  return new DOMException(message, 'EncodingError');
}

/**
 * Create an AbortError (e.g., operation was reset/closed)
 */
export function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

/**
 * Create a QuotaExceededError (e.g., queue full)
 */
export function quotaExceededError(message: string): DOMException {
  return new DOMException(message, 'QuotaExceededError');
}

/**
 * Create a TimeoutError (e.g., operation timed out)
 */
export function timeoutError(message: string): DOMException {
  return new DOMException(message, 'TimeoutError');
}

/**
 * Wrap an error as a DOMException if it isn't already
 *
 * @param error - The error to wrap
 * @param defaultName - The error name to use if error is not a DOMException
 */
export function wrapAsWebCodecsError(
  error: unknown,
  defaultName: WebCodecsErrorName = 'EncodingError'
): DOMException {
  if (error instanceof DOMException) {
    return error;
  }
  if (error instanceof Error) {
    return new DOMException(error.message, defaultName);
  }
  return new DOMException(String(error), defaultName);
}

/**
 * Check if an error is a specific WebCodecs error type
 */
export function isWebCodecsError(error: unknown, name: WebCodecsErrorName): boolean {
  return error instanceof DOMException && error.name === name;
}
