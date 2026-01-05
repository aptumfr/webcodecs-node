/**
 * EncodedVideoChunk - Represents a chunk of encoded video data
 * https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk
 */

import type { BufferSource } from '../types/index.js';
import { toUint8Array } from '../utils/buffer.js';

export type EncodedVideoChunkType = 'key' | 'delta';

export interface EncodedVideoChunkInit {
  type: EncodedVideoChunkType;
  timestamp: number;
  duration?: number;
  data: BufferSource;
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

    this._data = toUint8Array(init.data);

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
