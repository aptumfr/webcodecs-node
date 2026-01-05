/**
 * EncodedAudioChunk - Represents a chunk of encoded audio data
 * https://developer.mozilla.org/en-US/docs/Web/API/EncodedAudioChunk
 */

export type EncodedAudioChunkType = 'key' | 'delta';

export interface EncodedAudioChunkInit {
  type: EncodedAudioChunkType;
  timestamp: number;
  duration?: number;
  data: ArrayBufferView | ArrayBuffer;
  transfer?: ArrayBuffer[];
}

/** Check if an ArrayBuffer is detached */
function isDetached(buffer: ArrayBuffer): boolean {
  return buffer.byteLength === 0;
}

/** Validate and detach transfer list buffers */
function validateAndDetachTransfer(transfer: ArrayBuffer[] | undefined): void {
  if (!transfer || transfer.length === 0) return;

  // Check for duplicates
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

  // Detach all buffers
  for (const buffer of transfer) {
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

export class EncodedAudioChunk {
  private _type: EncodedAudioChunkType;
  private _timestamp: number;
  private _duration: number | null;
  private _data: ArrayBuffer;

  constructor(init: EncodedAudioChunkInit) {
    if (!init) {
      throw new TypeError('EncodedAudioChunkInit is required');
    }

    if (init.type !== 'key' && init.type !== 'delta') {
      throw new TypeError('type must be "key" or "delta"');
    }

    if (typeof init.timestamp !== 'number') {
      throw new TypeError('timestamp is required');
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

    // Validate transfer list before copying data
    if (init.transfer) {
      for (const buffer of init.transfer) {
        if (!(buffer instanceof ArrayBuffer)) {
          throw new TypeError('transfer list must only contain ArrayBuffer objects');
        }
        if (isDetached(buffer)) {
          throw new DOMException('Cannot transfer a detached ArrayBuffer', 'DataCloneError');
        }
      }
      // Check for duplicates
      const unique = new Set(init.transfer);
      if (unique.size !== init.transfer.length) {
        throw new DOMException('Duplicate ArrayBuffer in transfer list', 'DataCloneError');
      }
    }

    this._type = init.type;
    this._timestamp = init.timestamp;
    this._duration = init.duration ?? null;

    // Copy data first, then detach transfer buffers
    if (init.data instanceof ArrayBuffer) {
      // Always copy to avoid issues with transferred buffers
      this._data = init.data.slice(0);
    } else {
      const view = init.data;
      const srcBuffer = view.buffer as ArrayBuffer;
      this._data = srcBuffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }

    // Detach transferred buffers after data has been copied
    validateAndDetachTransfer(init.transfer);
  }

  get type(): EncodedAudioChunkType { return this._type; }
  get timestamp(): number { return this._timestamp; }
  get duration(): number | null { return this._duration; }
  get byteLength(): number { return this._data.byteLength; }

  copyTo(destination: ArrayBufferView): void {
    if (!destination) {
      throw new TypeError('destination is required');
    }

    const destArray = new Uint8Array(destination.buffer, destination.byteOffset, destination.byteLength);

    if (destArray.byteLength < this._data.byteLength) {
      throw new TypeError(`Destination buffer too small: ${destArray.byteLength} < ${this._data.byteLength}`);
    }

    destArray.set(new Uint8Array(this._data));
  }

  get _rawData(): Uint8Array {
    return new Uint8Array(this._data);
  }
}
