/**
 * Sample format conversion utilities for audio encoding
 */

/**
 * Convert f32 interleaved to f32 planar
 */
export function convertToPlanar(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
  const bytesPerSample = 4; // f32
  const planeSize = samplesPerChannel * bytesPerSample;
  const result = new Uint8Array(planeSize * numChannels);

  const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const output = new Float32Array(result.buffer);

  for (let s = 0; s < samplesPerChannel; s++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const srcIdx = s * numChannels + ch;
      const dstIdx = ch * samplesPerChannel + s;
      output[dstIdx] = input[srcIdx];
    }
  }

  return result;
}

/**
 * Convert f32 interleaved to s16 interleaved
 */
export function convertToS16Interleaved(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
  const totalSamples = samplesPerChannel * numChannels;
  const result = new Uint8Array(totalSamples * 2); // 2 bytes per s16 sample

  const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const output = new Int16Array(result.buffer);

  for (let i = 0; i < totalSamples; i++) {
    // Convert f32 [-1.0, 1.0] to s16 [-32768, 32767]
    const clamped = Math.max(-1.0, Math.min(1.0, input[i]));
    output[i] = Math.round(clamped * 32767);
  }

  return result;
}

/**
 * Convert f32 interleaved to s32 interleaved
 */
export function convertToS32Interleaved(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
  const totalSamples = samplesPerChannel * numChannels;
  const result = new Uint8Array(totalSamples * 4); // 4 bytes per s32 sample

  const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const output = new Int32Array(result.buffer);

  for (let i = 0; i < totalSamples; i++) {
    const clamped = Math.max(-1.0, Math.min(1.0, input[i]));
    output[i] = Math.round(clamped * 2147483647);
  }

  return result;
}

/**
 * Convert f32 interleaved to s16 planar
 */
export function convertToS16Planar(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
  const bytesPerSample = 2; // s16
  const planeSize = samplesPerChannel * bytesPerSample;
  const result = new Uint8Array(planeSize * numChannels);

  const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const output = new Int16Array(result.buffer);

  for (let s = 0; s < samplesPerChannel; s++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const srcIdx = s * numChannels + ch;
      const dstIdx = ch * samplesPerChannel + s;
      // Convert f32 [-1.0, 1.0] to s16 [-32768, 32767]
      const clamped = Math.max(-1.0, Math.min(1.0, input[srcIdx]));
      output[dstIdx] = Math.round(clamped * 32767);
    }
  }

  return result;
}

/**
 * Convert f32 interleaved to u8 interleaved
 */
export function convertToU8Interleaved(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
  const totalSamples = samplesPerChannel * numChannels;
  const result = new Uint8Array(totalSamples);

  const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);

  for (let i = 0; i < totalSamples; i++) {
    const clamped = Math.max(-1.0, Math.min(1.0, input[i]));
    const u8 = Math.round((clamped + 1) * 127.5); // map [-1,1] to [0,255]
    result[i] = u8;
  }

  return result;
}

// ============================================================================
// Reverse conversions: various formats -> f32 interleaved
// ============================================================================

/**
 * Convert f32 planar to f32 interleaved
 */
export function convertFromPlanarToInterleaved(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
  const bytesPerSample = 4; // f32
  const totalSamples = samplesPerChannel * numChannels;
  const result = new Uint8Array(totalSamples * bytesPerSample);

  const input = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const output = new Float32Array(result.buffer);

  for (let s = 0; s < samplesPerChannel; s++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const srcIdx = ch * samplesPerChannel + s;
      const dstIdx = s * numChannels + ch;
      output[dstIdx] = input[srcIdx];
    }
  }

  return result;
}

/**
 * Convert s16 interleaved to f32 interleaved
 */
export function convertFromS16ToF32Interleaved(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
  const totalSamples = samplesPerChannel * numChannels;
  const result = new Uint8Array(totalSamples * 4); // 4 bytes per f32 sample

  const input = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const output = new Float32Array(result.buffer);

  for (let i = 0; i < totalSamples; i++) {
    // Convert s16 [-32768, 32767] to f32 [-1.0, 1.0]
    output[i] = input[i] / 32768.0;
  }

  return result;
}

/**
 * Convert s16 planar to f32 interleaved
 */
export function convertFromS16PlanarToF32Interleaved(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
  const totalSamples = samplesPerChannel * numChannels;
  const result = new Uint8Array(totalSamples * 4); // 4 bytes per f32 sample

  const input = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const output = new Float32Array(result.buffer);

  for (let s = 0; s < samplesPerChannel; s++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const srcIdx = ch * samplesPerChannel + s;
      const dstIdx = s * numChannels + ch;
      // Convert s16 [-32768, 32767] to f32 [-1.0, 1.0]
      output[dstIdx] = input[srcIdx] / 32768.0;
    }
  }

  return result;
}

/**
 * Convert s32 interleaved to f32 interleaved
 */
export function convertFromS32ToF32Interleaved(data: Buffer, samplesPerChannel: number, numChannels: number): Uint8Array {
  const totalSamples = samplesPerChannel * numChannels;
  const result = new Uint8Array(totalSamples * 4); // 4 bytes per f32 sample

  const input = new Int32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const output = new Float32Array(result.buffer);

  for (let i = 0; i < totalSamples; i++) {
    // Convert s32 to f32 [-1.0, 1.0]
    output[i] = input[i] / 2147483648.0;
  }

  return result;
}
