/**
 * EncodedVideoChunk - Represents a chunk of encoded video data
 * https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk
 */

import type { BufferSource } from '../types/index.js';
import { toUint8Array, copyToUint8Array } from '../utils/buffer.js';
import { DOMException } from '../types/index.js';

export type EncodedVideoChunkType = 'key' | 'delta';

export interface EncodedVideoChunkInit {
  type: EncodedVideoChunkType;
  timestamp: number;
  duration?: number;
  data: BufferSource;
  /** ArrayBuffers to detach after chunk construction (transfer ownership) */
  transfer?: ArrayBuffer[];
}

/**
 * Check if an ArrayBuffer is detached
 * Uses the 'detached' property (Node.js 20+) when available.
 * On Node <20, we cannot reliably detect detachment so we assume NOT detached.
 */
function isDetached(buffer: ArrayBuffer): boolean {
  // Use the 'detached' property if available (Node.js 20+, modern browsers)
  if ('detached' in buffer) {
    return (buffer as any).detached === true;
  }
  // On Node <20, we cannot reliably distinguish empty from detached.
  // Assume NOT detached to avoid false positives on new ArrayBuffer(0).
  return false;
}

/**
 * Detach ArrayBuffers after construction
 */
function detachArrayBuffers(buffers: ArrayBuffer[] | undefined): void {
  if (!buffers || buffers.length === 0) return;

  for (const buffer of buffers) {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new TypeError('transfer list must only contain ArrayBuffer objects');
    }
    if (isDetached(buffer)) {
      throw new DOMException('Cannot transfer a detached ArrayBuffer', 'DataCloneError');
    }
    try {
      if (typeof (buffer as any).transfer === 'function') {
        (buffer as any).transfer();
      } else if (typeof structuredClone === 'function') {
        structuredClone(buffer, { transfer: [buffer] });
      }
    } catch {
      // Ignore errors during detachment
    }
  }
}

export class EncodedVideoChunk {
  private _data: Uint8Array;

  readonly type: EncodedVideoChunkType;
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;

  constructor(init: EncodedVideoChunkInit) {
    if (!init.type || (init.type !== 'key' && init.type !== 'delta')) {
      throw new TypeError("type must be 'key' or 'delta'");
    }
    if (typeof init.timestamp !== 'number') {
      throw new TypeError('timestamp must be a number');
    }
    if (!init.data) {
      throw new TypeError('data is required');
    }

    // Validate duration per WebCodecs spec (EnforceRange behavior)
    if (init.duration !== undefined) {
      if (typeof init.duration !== 'number' || !Number.isFinite(init.duration) || init.duration < 0) {
        throw new TypeError('duration must be a non-negative finite number');
      }
    }

    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration ?? null;

    // Validate transfer list if provided
    if (init.transfer) {
      const seen = new Set<ArrayBuffer>();
      for (const buffer of init.transfer) {
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

    // Copy data (use copyToUint8Array when transfer is specified to avoid view issues)
    this._data = init.transfer && init.transfer.length > 0
      ? copyToUint8Array(init.data)
      : toUint8Array(init.data);

    // Detach transferred buffers after data has been copied
    detachArrayBuffers(init.transfer);

    this.byteLength = this._data.byteLength;
  }

  copyTo(destination: BufferSource): void {
    const destArray = toUint8Array(destination);

    if (destArray.byteLength < this._data.byteLength) {
      throw new TypeError('destination buffer is too small');
    }

    destArray.set(this._data);
  }

  get _buffer(): Uint8Array {
    return this._data;
  }
}
