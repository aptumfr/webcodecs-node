/**
 * Transfer list validation utilities
 *
 * These utilities validate transfer lists for WebCodecs constructors
 * that support the transfer option for zero-copy buffer ownership transfer.
 */

import { isDetached } from './detach.js';

/**
 * Validate a transfer list for WebCodecs-compliant transfer semantics.
 *
 * Checks:
 * - All items are ArrayBuffer instances
 * - No duplicate buffers in the list
 * - No already-detached buffers
 *
 * @throws {TypeError} If transfer list contains non-ArrayBuffer items
 * @throws {DOMException} DataCloneError if duplicates or detached buffers found
 */
export function validateTransferList(transferList: unknown[]): void {
  const seen = new Set<ArrayBuffer>();

  for (const item of transferList) {
    if (!(item instanceof ArrayBuffer)) {
      throw new TypeError('transfer list must only contain ArrayBuffer objects');
    }

    if (seen.has(item)) {
      throw new DOMException('Duplicate ArrayBuffer in transfer list', 'DataCloneError');
    }

    if (isDetached(item)) {
      throw new DOMException('Cannot transfer a detached ArrayBuffer', 'DataCloneError');
    }

    seen.add(item);
  }
}

/**
 * Validate that a buffer source is not detached.
 *
 * @throws {TypeError} If the buffer is detached
 */
export function validateNotDetached(data: BufferSource, name: string = 'buffer'): void {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer;

  if (isDetached(buffer)) {
    throw new TypeError(`${name} ArrayBuffer is detached`);
  }
}

/**
 * Validate that an optional description buffer is not detached.
 * Used for decoder/encoder configure() calls that accept a description parameter.
 *
 * @throws {TypeError} If the description buffer is detached
 */
export function validateDescriptionNotDetached(
  description: BufferSource | undefined
): void {
  if (description === undefined) {
    return;
  }

  const buffer = description instanceof ArrayBuffer
    ? description
    : (description as ArrayBufferView).buffer;

  // Use the more robust check from AudioDecoder
  const detached = (buffer as any).detached === true ||
    ((buffer as any).detached === undefined && buffer.byteLength === 0 &&
     !(description instanceof ArrayBuffer && description.byteLength === 0));

  if (detached) {
    throw new TypeError('description ArrayBuffer is detached');
  }
}

/**
 * Check if a buffer source references a buffer in the transfer list.
 *
 * This is used to determine if data should be transferred (moved) vs copied.
 */
export function isInTransferList(
  data: BufferSource,
  transferList: ArrayBuffer[] | undefined
): boolean {
  if (!transferList || transferList.length === 0) {
    return false;
  }

  const buffer = data instanceof ArrayBuffer ? data : data.buffer;
  return transferList.includes(buffer);
}

/**
 * Perform buffer detachment for items in a transfer list.
 *
 * This simulates the transfer behavior by using structuredClone when available.
 * After this call, the original buffers should be considered detached.
 */
export function detachTransferredBuffers(transferList: ArrayBuffer[]): void {
  if (typeof structuredClone !== 'function') {
    // Can't truly detach without structuredClone
    return;
  }

  for (const buffer of transferList) {
    try {
      structuredClone(buffer, { transfer: [buffer] });
    } catch {
      // Buffer may already be detached or not transferable
    }
  }
}
