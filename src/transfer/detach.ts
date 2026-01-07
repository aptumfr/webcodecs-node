/**
 * ArrayBuffer detachment utilities
 *
 * These utilities handle ArrayBuffer transfer semantics for WebCodecs objects.
 * Detached buffers cannot be accessed and indicate ownership transfer.
 */

/**
 * Check if an ArrayBuffer is detached (transferred or neutered).
 *
 * In Node.js 20+, ArrayBuffer has a .detached property.
 * For older versions, we use a conservative heuristic:
 * - If _intentionallyEmpty flag is set, buffer is not detached
 * - Otherwise, assume NOT detached (false negatives are safer than false positives)
 *
 * Note: On Node <20 without .detached, we cannot reliably distinguish between
 * an intentionally empty buffer (new ArrayBuffer(0)) and a detached buffer.
 * We err on the side of NOT detached to avoid false positives.
 */
export function isDetached(buffer: ArrayBuffer): boolean {
  // Node.js 20+ has a .detached property - use it if available
  if ('detached' in buffer) {
    return (buffer as any).detached === true;
  }

  // Fallback for Node <20: we can only detect truly detached buffers
  // if we marked them with _intentionallyEmpty (for our internal buffers)
  if ((buffer as any)._intentionallyEmpty) {
    return false;
  }

  // For user-provided buffers on Node <20, we CANNOT reliably detect detachment.
  // byteLength === 0 could be either a detached buffer OR a legitimately empty one.
  // We assume NOT detached to avoid false positives on empty buffers.
  // If the buffer truly is detached, operations will fail naturally later.
  return false;
}

/**
 * Check if an ArrayBuffer is detached using strict mode.
 *
 * This is a stricter check that treats byteLength === 0 as detached on Node <20.
 * Only use this when you're certain the buffer should NOT be empty.
 */
export function isDetachedStrict(buffer: ArrayBuffer): boolean {
  // Node.js 20+ has a .detached property - use it if available
  if ('detached' in buffer) {
    return (buffer as any).detached === true;
  }

  // On Node <20, byteLength === 0 is the only signal we have
  return buffer.byteLength === 0;
}

/**
 * Detach an ArrayBuffer by transferring it to a worker-like structure.
 *
 * This is a simulated detach since Node.js doesn't have structured clone
 * transfer in the same way browsers do. We create a new buffer and mark
 * the original as "detached" by setting a flag.
 *
 * Note: This doesn't actually transfer memory; it copies and marks.
 * For true zero-copy transfer, use MessageChannel or worker postMessage.
 */
export function detachBuffer(buffer: ArrayBuffer): ArrayBuffer {
  if (isDetached(buffer)) {
    throw new DOMException('Cannot detach an already detached ArrayBuffer', 'DataCloneError');
  }

  // Create a copy of the data
  const copy = buffer.slice(0);

  // Mark the original as detached (this is a simulation)
  // In reality, structured clone transfer would handle this
  try {
    // Try to use structuredClone with transfer if available
    if (typeof structuredClone === 'function') {
      structuredClone(buffer, { transfer: [buffer] });
    }
  } catch {
    // If structuredClone fails, we can't truly detach
    // The copy is still valid though
  }

  return copy;
}

/**
 * Create a copy of buffer data, handling typed arrays and ArrayBuffers.
 */
export function copyBufferData(data: BufferSource): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data.slice(0));
  }

  // TypedArray or DataView
  const view = data instanceof DataView
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  // Create a copy
  return new Uint8Array(view);
}
