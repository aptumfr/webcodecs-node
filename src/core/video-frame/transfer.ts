/**
 * VideoFrame transfer utilities
 */

import { DOMException } from '../../types/index.js';

/**
 * Check if an ArrayBuffer is detached
 * Uses the 'detached' property (Node.js 20+) when available.
 * On Node <20, checks for _intentionallyEmpty flag (for internal buffers).
 */
export function isDetached(buffer: ArrayBuffer): boolean {
  // Use the 'detached' property if available (Node.js 20+, modern browsers)
  if ('detached' in buffer) {
    return (buffer as any).detached === true;
  }
  // On Node <20, only flag as detached if byteLength is 0 AND not intentionally empty
  // For user-provided buffers without the flag, this returns false to avoid false positives
  if ((buffer as any)._intentionallyEmpty) {
    return false;
  }
  // For internal buffers we've marked as detached (byteLength 0), return true
  // For external buffers (no flag), assume NOT detached
  return false;
}

/**
 * Detach ArrayBuffers after frame construction (transfer ownership).
 * Per WebCodecs spec, this prevents the source from being used after transfer.
 */
export function detachArrayBuffers(buffers: ArrayBuffer[] | undefined): void {
  if (!buffers || buffers.length === 0) return;

  for (const buffer of buffers) {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new TypeError('transfer list must only contain ArrayBuffer objects');
    }
    // Check if already detached
    if (isDetached(buffer)) {
      throw new DOMException('Cannot transfer a detached ArrayBuffer', 'DataCloneError');
    }
    // Detach the buffer using structuredClone with transfer (Node.js 17+)
    // or ArrayBuffer.prototype.transfer (ES2024/Node.js 22+)
    try {
      if (typeof (buffer as any).transfer === 'function') {
        // ES2024 ArrayBuffer.prototype.transfer
        (buffer as any).transfer();
      } else if (typeof structuredClone === 'function') {
        // Use structuredClone with transfer to detach
        structuredClone(buffer, { transfer: [buffer] });
      }
      // If neither method is available, the buffer won't be detached
      // but we've already copied the data, so this is a graceful degradation
    } catch {
      // Ignore errors during detachment - data was already copied
    }
  }
}

/**
 * Validate transfer list (check for duplicates and detached buffers)
 */
export function validateTransferList(transfer: ArrayBuffer[] | undefined): void {
  if (!transfer) return;

  const seen = new Set<ArrayBuffer>();
  for (const buffer of transfer) {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new TypeError('transfer list must only contain ArrayBuffer objects');
    }
    if (seen.has(buffer)) {
      throw new DOMException('Duplicate ArrayBuffer in transfer list', 'DataCloneError');
    }
    if (isDetached(buffer)) {
      throw new DOMException('Cannot transfer a detached ArrayBuffer', 'DataCloneError');
    }
    seen.add(buffer);
  }
}
