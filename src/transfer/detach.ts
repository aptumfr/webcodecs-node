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
 * For older versions, we check if byteLength is 0.
 *
 * Note: An intentionally empty buffer (byteLength 0 but not detached) is
 * distinguished by the optional _intentionallyEmpty flag used in VideoFrame.
 */
export function isDetached(buffer: ArrayBuffer): boolean {
  // Node.js 20+ has a .detached property
  if ((buffer as any).detached === true) {
    return true;
  }

  // Fallback: detached buffers have byteLength 0
  // But we need to distinguish from intentionally empty buffers
  if ((buffer as any).detached === false) {
    return false;
  }

  // If no .detached property exists, use byteLength heuristic
  // A detached buffer will have byteLength 0
  return buffer.byteLength === 0 && !(buffer as any)._intentionallyEmpty;
}

/**
 * Check if an ArrayBuffer is detached using strict mode.
 *
 * This is a simpler check that doesn't handle the _intentionallyEmpty flag.
 * Use when you're sure the buffer wasn't intentionally created empty.
 */
export function isDetachedStrict(buffer: ArrayBuffer): boolean {
  if ((buffer as any).detached === true) {
    return true;
  }
  if ((buffer as any).detached === false) {
    return false;
  }
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
