/**
 * VideoFrame transfer utilities
 */

import { DOMException } from '../../types/index.js';

/**
 * Check if an ArrayBuffer is detached
 */
export function isDetached(buffer: ArrayBuffer): boolean {
  return buffer.byteLength === 0 && !(buffer as any)._intentionallyEmpty;
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
